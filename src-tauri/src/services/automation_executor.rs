use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

use crate::db::models::{AppNotification, Automation, AutomationRun};
use crate::db::queries::{automations as auto_queries, projects as project_queries, settings as settings_queries};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

use super::automation_scheduler;
use super::claude_cli::{spawn_claude, SpawnClaudeOptions};
use super::skills_engine;
use super::worktree_manager;

/// Sandbox policy determines what tools the automation agent may use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SandboxPolicy {
    ReadOnly,
    WorkspaceWrite,
    Full,
}

impl SandboxPolicy {
    fn from_str(s: &str) -> Self {
        match s {
            "read-only" => Self::ReadOnly,
            "full" => Self::Full,
            _ => Self::WorkspaceWrite,
        }
    }

    fn tools(&self) -> Vec<String> {
        match self {
            Self::ReadOnly => vec![
                "Read".into(),
                "Glob".into(),
                "Grep".into(),
            ],
            Self::WorkspaceWrite => vec![
                "Read".into(),
                "Edit".into(),
                "Write".into(),
                "Glob".into(),
                "Grep".into(),
                "Bash".into(),
            ],
            Self::Full => vec![
                "Read".into(),
                "Edit".into(),
                "Write".into(),
                "Bash".into(),
                "Glob".into(),
                "Grep".into(),
                "WebSearch".into(),
                "WebFetch".into(),
            ],
        }
    }

    fn is_tool_allowed(&self, tool: &str) -> bool {
        self.tools().iter().any(|t| t == tool)
    }
}

/// Execute an automation run.
///
/// This spawns a Claude CLI process, captures its conversational output,
/// stores results in the automation_runs table, and sends notifications.
pub async fn execute_run(
    app_handle: AppHandle,
    state: &AppState,
    automation: &Automation,
    run: &AutomationRun,
) -> AppResult<()> {
    let sandbox_policy_str = automation
        .trigger_config
        .get("sandboxPolicy")
        .and_then(|v| v.as_str())
        .unwrap_or("workspace-write");
    let sandbox_policy = SandboxPolicy::from_str(sandbox_policy_str);

    let mut worktree_path: Option<String> = None;

    let result: Result<(), AppError> = async {
        // 1. Create a fresh git worktree (for git projects)
        let project = {
            let db = state.db.lock();
            project_queries::get_project(&db, &automation.project_id)
                .map_err(AppError::from)?
        };

        if let Some(ref project) = project {
            match worktree_manager::create(
                &project.path,
                &format!("auto-{}", &run.id[..8.min(run.id.len())]),
                Some(&format!("Automation: {}", automation.name)),
            )
            .await
            {
                Ok(wt) => {
                    worktree_path = Some(wt.path.clone());
                    info!(
                        target: "automation-executor",
                        "Created worktree for run {}: {}", run.id, wt.path
                    );
                }
                Err(e) => {
                    warn!(
                        target: "automation-executor",
                        "Failed to create worktree, using project directory: {}", e
                    );
                }
            }
        }

        // 2. Load associated skills and build system prompt
        let mut system_prompt = String::new();
        let mut allowed_tools = sandbox_policy.tools();

        if !automation.skill_ids.is_empty() {
            let db = state.db.lock();
            for skill_id in &automation.skill_ids {
                if let Ok(Some(skill)) = skills_engine::resolve(&db, skill_id) {
                    if let Ok(config) = skills_engine::invoke(&skill) {
                        system_prompt.push_str(&config.system_prompt);
                        system_prompt.push_str("\n\n");

                        for tool in &config.tools {
                            if !allowed_tools.contains(tool)
                                && sandbox_policy.is_tool_allowed(tool)
                            {
                                allowed_tools.push(tool.clone());
                            }
                        }
                    }
                }
            }
        }

        // 3. Build the prompt
        let full_prompt = if !system_prompt.is_empty() {
            format!("{}\n---\n\n{}", system_prompt, automation.prompt)
        } else {
            automation.prompt.clone()
        };

        // 4. Launch agent via CLI spawn
        let cwd = worktree_path
            .as_deref()
            .or(project.as_ref().map(|p| p.path.as_str()))
            .unwrap_or(".")
            .to_string();

        let claude_cli_path = {
            let db = state.db.lock();
            settings_queries::get_app_settings(&db)
                .ok()
                .and_then(|s| s.claude_cli_path)
        };

        let permission_mode = match sandbox_policy {
            SandboxPolicy::ReadOnly => "plan",
            _ => "acceptEdits",
        };

        let spawn_result = spawn_claude(SpawnClaudeOptions {
            prompt: full_prompt,
            cwd,
            model: None,
            resume_session_id: None,
            permission_mode: Some(permission_mode.to_string()),
            allowed_tools: Some(allowed_tools),
            disallowed_tools: None,
            append_system_prompt: None,
            claude_path: claude_cli_path,
        })
        .map_err(|e| AppError::Agent(format!("Failed to spawn Claude CLI: {}", e)))?;

        let mut events_rx = spawn_result.events_rx;
        // We don't need stdin_tx for automations, and kill_tx is for cancellation
        let _kill_tx = spawn_result.kill_tx;

        let mut conversation: Vec<serde_json::Value> = Vec::new();
        let mut total_cost_usd: f64 = 0.0;

        while let Some(event) = events_rx.recv().await {
            match event.event_type.as_str() {
                "assistant" => {
                    if let Some(ref msg) = event.message {
                        let text: String = msg
                            .content
                            .iter()
                            .filter(|b| b.block_type == "text")
                            .filter_map(|b| b.text.as_deref())
                            .collect::<Vec<_>>()
                            .join("");
                        if !text.is_empty() {
                            conversation.push(serde_json::json!({
                                "role": "assistant",
                                "content": text,
                            }));
                        }
                    }
                }
                "result" => {
                    if let Some(ref result_text) = event.result {
                        conversation.push(serde_json::json!({
                            "role": "assistant",
                            "content": result_text,
                        }));
                    }
                    total_cost_usd = event.total_cost_usd.unwrap_or(0.0);
                }
                _ => {}
            }
        }

        // 5. Store results in automation_runs table
        let result_data = serde_json::json!({
            "conversation": conversation,
            "totalCostUsd": total_cost_usd,
            "worktreePath": worktree_path,
            "sandboxPolicy": sandbox_policy_str,
        });

        let has_actionable_output =
            !conversation.is_empty()
                && conversation.iter().any(|c| {
                    c.get("content")
                        .and_then(|v| v.as_str())
                        .map(|s| s.len() > 50)
                        .unwrap_or(false)
                });

        {
            let db = state.db.lock();
            automation_scheduler::complete_run(&db, &run.id, "completed", Some(&result_data))?;

            // Auto-archive if no actionable output
            if !has_actionable_output {
                let archive_updates = serde_json::json!({ "status": "archived" });
                let _ = auto_queries::update_automation_run(&db, &run.id, &archive_updates);
            }
        }

        // 6. Notify user
        send_notification(
            &app_handle,
            state,
            &automation.name,
            "success",
            &format!("Automation \"{}\" completed", automation.name),
        );

        info!(
            target: "automation-executor",
            "Run {} completed for {}", run.id, automation.name
        );

        Ok(())
    }
    .await;

    if let Err(e) = result {
        let message = e.to_string();

        {
            let db = state.db.lock();
            let error_result = serde_json::json!({ "error": message });
            let _ = automation_scheduler::complete_run(&db, &run.id, "failed", Some(&error_result));
        }

        send_notification(
            &app_handle,
            state,
            &automation.name,
            "error",
            &format!("Automation \"{}\" failed: {}", automation.name, message),
        );

        error!(
            target: "automation-executor",
            "Run {} failed for {}: {}", run.id, automation.name, message
        );

        return Err(AppError::Agent(message));
    }

    Ok(())
}

/// Send a notification to the frontend via Tauri events.
fn send_notification(
    app_handle: &AppHandle,
    state: &AppState,
    title: &str,
    notification_type: &str,
    message: &str,
) {
    let notification = AppNotification {
        id: uuid::Uuid::new_v4().to_string(),
        notification_type: notification_type.to_string(),
        title: title.to_string(),
        message: message.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    // Store in notification history
    {
        let mut notifications = state.notifications.lock();
        notifications.insert(0, notification.clone());
        if notifications.len() > 100 {
            notifications.truncate(100);
        }
    }

    let _ = app_handle.emit("notification", &notification);
}
