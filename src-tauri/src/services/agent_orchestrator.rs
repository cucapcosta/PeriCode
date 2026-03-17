//! Agent orchestrator — the core service that manages agent lifecycle.
//!
//! This is the Rust port of the 1303-line `agent-orchestrator.ts` from the
//! Electron codebase. It manages:
//!
//! - Launching Claude CLI agents (and Copilot agents in the future)
//! - Concurrency limiting with a configurable queue
//! - Cost tracking with cumulative-to-delta conversion
//! - Streaming events to the frontend via Tauri events
//! - Permission request/response handling
//! - Session registry integration
//! - Worktree creation for isolated agent workspaces

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::db::models::{
    AgentLaunchConfig, AppSettings, MessageContent, ModelTokenUsage,
    PermissionResponse, ThreadInfo,
};
use crate::db::queries::{
    messages as message_queries,
    model_usage as model_usage_queries,
    projects as project_queries,
    settings as settings_queries,
    threads as thread_queries,
};
use crate::error::{AppError, AppResult};
use crate::state::{ActiveAgent, AppState};
use crate::utils::model_pricing::estimate_cost;

use super::claude_cli::{self, CliEvent, SpawnClaudeOptions};
use super::session_registry;
use super::worktree_manager;

// ── Constants ──────────────────────────────────────────────

const DEFAULT_TOOLS: &[&str] = &[
    "Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", "WebFetch",
];

/// Tools that break non-interactive (-p) mode.
const DISALLOWED_TOOLS: &[&str] = &["EnterPlanMode"];

const NON_INTERACTIVE_SYSTEM_PROMPT: &str =
    "You are running in non-interactive print mode. \
     DO NOT enter plan mode. Implement all requested changes directly. \
     Write code, create files, and make edits immediately without asking for confirmation.";

// ── Types ──────────────────────────────────────────────────

/// Cost info for a single agent thread.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostInfo {
    pub cost_usd: f64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub model_usage: HashMap<String, ModelTokenUsage>,
}

/// Internal streaming state used by `process_assistant_event`.
struct StreamState {
    last_seen_text_length: usize,
    current_block_index: i32,
    seen_tool_use_ids: HashSet<String>,
}

impl StreamState {
    fn new() -> Self {
        Self {
            last_seen_text_length: 0,
            current_block_index: 0,
            seen_tool_use_ids: HashSet::new(),
        }
    }
}

// ── Public API ─────────────────────────────────────────────

/// Launch a new agent for the given configuration.
///
/// If the concurrency limit is reached the agent is queued and launched
/// when a slot becomes available. Returns the newly created `ThreadInfo`.
pub async fn launch(
    app_handle: AppHandle,
    state: &AppState,
    config: AgentLaunchConfig,
) -> AppResult<ThreadInfo> {
    // Check budget cap
    {
        let db = state.db.lock();
        let project = project_queries::get_project(&db, &config.project_id)
            .map_err(AppError::from)?;
        if let Some(ref project) = project {
            if let Some(budget_cap) = project.settings.max_budget_usd {
                let orch = state.orchestrator.read();
                let current_cost = orch
                    .project_costs
                    .get(&config.project_id)
                    .copied()
                    .unwrap_or(0.0);
                if current_cost >= budget_cap {
                    return Err(AppError::Agent(format!(
                        "Project budget cap reached (${:.2} / ${:.2})",
                        current_cost, budget_cap
                    )));
                }
            }
        }
    }

    let thread_id = uuid::Uuid::new_v4().to_string();

    if can_launch(state) {
        return launch_immediate(app_handle, state, &config, &thread_id).await;
    }

    // Queue the agent
    let running = {
        let orch = state.orchestrator.read();
        orch.active_agents.len()
    };
    let max = {
        let orch = state.orchestrator.read();
        orch.max_concurrent
    };

    info!(
        target: "agent-orchestrator",
        "Agent {} queued ({}/{} running)", thread_id, running, max
    );

    {
        let mut orch = state.orchestrator.write();
        orch.queued_count += 1;
    }

    // In Rust we cannot easily queue a Promise like TS does. Instead, we
    // immediately create the thread in "queued" status and launch it when
    // a slot opens. The frontend polls status to detect transitions.
    let db = state.db.lock();
    let title = config.prompt.chars().take(100).collect::<String>();
    let thread = thread_queries::create_thread(
        &db,
        &thread_id,
        &config.project_id,
        Some(&title),
        None,
        None,
        None,
        config.provider.as_ref().map(|p| {
            serde_json::to_string(p).unwrap_or_else(|_| "\"claude\"".into())
        }).as_deref(),
        config.model.as_deref(),
    )
    .map_err(AppError::from)?;
    thread_queries::update_thread_status(&db, &thread_id, "queued").map_err(AppError::from)?;
    drop(db);

    // Spawn a task that waits for a slot and then launches.
    // We retrieve AppState from the AppHandle inside the spawned future
    // so we don't need to carry a raw pointer across thread boundaries.
    let config_clone = config.clone();
    let thread_id_clone = thread_id.clone();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        let state_handle: tauri::State<'_, AppState> = app_handle_clone.state();
        let state_ref: &AppState = &state_handle;

        // Poll until a slot opens
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if can_launch(state_ref) {
                break;
            }
        }

        {
            let mut orch = state_ref.orchestrator.write();
            orch.queued_count = orch.queued_count.saturating_sub(1);
        }

        match launch_immediate(
            app_handle_clone.clone(),
            state_ref,
            &config_clone,
            &thread_id_clone,
        )
        .await
        {
            Ok(_) => {}
            Err(e) => {
                error!(
                    target: "agent-orchestrator",
                    "Queued agent {} launch failed: {}", thread_id_clone, e
                );
            }
        }
    });

    Ok(thread)
}

/// Cancel a running or queued agent.
pub fn cancel(state: &AppState, thread_id: &str) {
    // If queued, decrement queue count
    {
        let mut orch = state.orchestrator.write();
        if orch.queued_count > 0 {
            // We can't easily remove from a polling queue, but we can mark
            // the thread as failed so the queued task sees it
        }

        // Kill active agent
        if let Some(agent) = orch.active_agents.remove(thread_id) {
            if let Some(tx) = agent.cancel_tx {
                let _ = tx.send(());
            }
        }
    }

    // Always update status (handles stale "running" threads from previous sessions)
    let db = state.db.lock();
    let _ = thread_queries::update_thread_status(&db, thread_id, "failed");
    drop(db);

    info!(target: "agent-orchestrator", "Agent {} cancelled", thread_id);
}

/// Send a follow-up message to an existing thread.
///
/// Resumes the Claude CLI session for the thread and processes events
/// identically to the initial launch.
pub async fn send_message(
    app_handle: AppHandle,
    state: &AppState,
    thread_id: &str,
    message: &str,
    image_paths: Option<&[String]>,
) -> AppResult<()> {
    let (thread, project_data) = {
        let db = state.db.lock();
        let thread = thread_queries::get_thread(&db, thread_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound(format!("Thread not found: {}", thread_id)))?;

        let project_data = project_queries::get_project(&db, &thread.project_id)
            .map_err(AppError::from)?;

        (thread, project_data)
    };

    let cwd = thread
        .worktree_path
        .as_deref()
        .or(project_data.as_ref().map(|p| p.path.as_str()))
        .unwrap_or(".")
        .to_string();
    let project_id = thread.project_id.clone();

    // Store user message
    {
        let db = state.db.lock();
        let msg_id = uuid::Uuid::new_v4().to_string();
        let content = vec![MessageContent {
            content_type: "text".to_string(),
            text: Some(message.to_string()),
            tool_name: None,
            tool_input: None,
            tool_output: None,
        }];
        message_queries::add_message(
            &db, &msg_id, thread_id, "user", &content, None, None, None, None,
        )
        .map_err(AppError::from)?;
    }

    let (app_settings, resolved_mode, resolved_tools) = {
        let db = state.db.lock();
        let app_settings = settings_queries::get_app_settings(&db).map_err(AppError::from)?;
        let (mode, tools) = resolve_permission_config(&app_settings, None);
        (app_settings, mode, tools)
    };

    let full_prompt = build_prompt_with_images(message, image_paths);

    // Look up or restore session
    let mut session_id = session_registry::get_session_id(state, thread_id);
    if session_id.is_none() {
        if let Some(ref sid) = thread.session_id {
            session_registry::register(state, thread_id, sid);
            session_id = Some(sid.clone());
        }
    }

    let session_id = session_id.ok_or_else(|| {
        AppError::Agent(format!(
            "No session found for thread {}. The session may have been lost.",
            thread_id
        ))
    })?;

    let model = thread
        .model
        .as_deref()
        .or(Some(&app_settings.default_model))
        .map(|s| s.to_string());

    let spawn_result = claude_cli::spawn_claude(SpawnClaudeOptions {
        prompt: full_prompt,
        cwd,
        model,
        resume_session_id: Some(session_id),
        permission_mode: Some(resolved_mode),
        allowed_tools: Some(resolved_tools),
        disallowed_tools: Some(DISALLOWED_TOOLS.iter().map(|s| s.to_string()).collect()),
        append_system_prompt: Some(NON_INTERACTIVE_SYSTEM_PROMPT.to_string()),
        claude_path: app_settings.claude_cli_path.clone(),
    })
    .map_err(|e| AppError::Agent(format!("Failed to spawn Claude CLI: {}", e)))?;

    let events_rx = spawn_result.events_rx;
    let kill_tx = spawn_result.kill_tx;
    let stdin_tx = spawn_result.stdin_tx;

    // Register active agent
    let run_id = uuid::Uuid::new_v4().to_string();
    {
        let mut orch = state.orchestrator.write();
        orch.active_agents.insert(
            thread_id.to_string(),
            ActiveAgent {
                thread_id: thread_id.to_string(),
                project_id: project_id.clone(),
                run_id: run_id.clone(),
                cancel_tx: Some(kill_tx),
                stdin_tx: Some(stdin_tx),
                cost_usd: 0.0,
                tokens_in: 0,
                tokens_out: 0,
                model_usage: HashMap::new(),
            },
        );
    }

    {
        let db = state.db.lock();
        let _ = thread_queries::update_thread_status(&db, thread_id, "running");
    }

    let _ = app_handle.emit("agent:status", (thread_id, "running"));

    // Spawn background task to process events (same pattern as launch_immediate).
    // This returns immediately so the frontend invoke resolves and the UI stays
    // responsive. Streaming events flow via Tauri emits, not the invoke return.
    let thread_id_owned = thread_id.to_string();
    let project_id_owned = project_id.clone();
    let app_handle_for_task = app_handle.clone();

    tokio::spawn(async move {
        let state_handle: tauri::State<'_, AppState> = app_handle_for_task.state();
        let state_ref: &AppState = &state_handle;
        let app_handle_inner = app_handle_for_task.clone();
        run_agent_events(
            app_handle_inner,
            state_ref,
            &thread_id_owned,
            &project_id_owned,
            &run_id,
            events_rx,
        )
        .await;
    });

    Ok(())
}

/// Respond to a permission (control_request) from the Claude CLI.
pub fn respond_permission(state: &AppState, response: &PermissionResponse) {
    let orch = state.orchestrator.read();
    let agent = match orch.active_agents.get(&response.thread_id) {
        Some(a) => a,
        None => {
            warn!(
                target: "agent-orchestrator",
                "Cannot respond to permission: no agent for {}", response.thread_id
            );
            return;
        }
    };

    let stdin_tx = match &agent.stdin_tx {
        Some(tx) => tx.clone(),
        None => {
            warn!(
                target: "agent-orchestrator",
                "Cannot respond to permission: no stdin for {}", response.thread_id
            );
            return;
        }
    };

    let control_response = if response.allow {
        serde_json::json!({
            "type": "control_response",
            "request_id": response.request_id,
            "response": {
                "subtype": "success",
                "response": { "behavior": "allow" },
            }
        })
    } else {
        serde_json::json!({
            "type": "control_response",
            "request_id": response.request_id,
            "response": {
                "subtype": "success",
                "response": {
                    "behavior": "deny",
                    "message": response.message.as_deref().unwrap_or("User denied this action"),
                },
            }
        })
    };

    let json_str = serde_json::to_string(&control_response).unwrap_or_default();
    let request_id = response.request_id.clone();
    let thread_id = response.thread_id.clone();
    let allow = response.allow;

    tokio::spawn(async move {
        let _ = stdin_tx.send(json_str).await;
    });

    info!(
        target: "agent-orchestrator",
        "Permission response for {}: {} ({})",
        thread_id,
        if allow { "allow" } else { "deny" },
        request_id
    );
}

/// Shut down all running agents.
pub fn shutdown_all(state: &AppState) {
    let mut orch = state.orchestrator.write();
    for (_id, agent) in orch.active_agents.drain() {
        if let Some(tx) = agent.cancel_tx {
            let _ = tx.send(());
        }
    }
    orch.queued_count = 0;
    info!(target: "agent-orchestrator", "All agents shut down");
}

/// Get IDs of all currently running agent threads.
pub fn get_running_thread_ids(state: &AppState) -> Vec<String> {
    let orch = state.orchestrator.read();
    orch.active_agents.keys().cloned().collect()
}

/// Get the count of running agents.
pub fn get_running_agents_count(state: &AppState) -> usize {
    let orch = state.orchestrator.read();
    orch.active_agents.len()
}

/// Get the count of queued agents.
pub fn get_queued_count(state: &AppState) -> usize {
    let orch = state.orchestrator.read();
    orch.queued_count
}

/// Get the total cost across all projects.
pub fn get_total_cost(state: &AppState) -> f64 {
    let orch = state.orchestrator.read();
    orch.project_costs.values().sum()
}

/// Get cost info for a specific agent thread.
pub fn get_agent_cost(state: &AppState, thread_id: &str) -> Option<CostInfo> {
    let orch = state.orchestrator.read();
    orch.active_agents.get(thread_id).map(|agent| CostInfo {
        cost_usd: agent.cost_usd,
        tokens_in: agent.tokens_in,
        tokens_out: agent.tokens_out,
        model_usage: agent.model_usage.clone(),
    })
}

/// Get the global per-model token usage accumulator (deep copy).
pub fn get_global_model_usage(state: &AppState) -> HashMap<String, ModelTokenUsage> {
    let orch = state.orchestrator.read();
    let mut copy = HashMap::new();
    for (model, usage) in &orch.global_model_usage {
        copy.insert(model.clone(), usage.clone());
    }
    copy
}

/// Get the cost for a specific project.
pub fn get_project_cost(state: &AppState, project_id: &str) -> f64 {
    let orch = state.orchestrator.read();
    orch.project_costs.get(project_id).copied().unwrap_or(0.0)
}

/// Set the maximum number of concurrent agents.
pub fn set_max_concurrent(state: &AppState, n: usize) {
    let mut orch = state.orchestrator.write();
    orch.max_concurrent = n.max(1);
    info!(
        target: "agent-orchestrator",
        "Max concurrent agents set to {}", orch.max_concurrent
    );
}

/// Load historical costs from the database into the in-memory state.
///
/// Called once at startup to restore cost tracking across app restarts.
pub fn load_costs_from_db(state: &AppState) {
    let db = state.db.lock();

    match model_usage_queries::get_all_project_costs(&db) {
        Ok(costs) => {
            let mut orch = state.orchestrator.write();
            for (project_id, cost) in costs {
                orch.project_costs.insert(project_id, cost);
            }
        }
        Err(e) => {
            warn!(
                target: "agent-orchestrator",
                "Failed to load project costs from database: {}", e
            );
        }
    }

    match model_usage_queries::get_global_model_usage(&db) {
        Ok(usage) => {
            let mut orch = state.orchestrator.write();
            merge_model_usage(&mut orch.global_model_usage, &usage);
        }
        Err(e) => {
            warn!(
                target: "agent-orchestrator",
                "Failed to load model usage from database: {}", e
            );
        }
    }

    info!(
        target: "agent-orchestrator",
        "Loaded historical costs from database"
    );
}

/// Check whether an agent is currently running.
pub fn is_running(state: &AppState, thread_id: &str) -> bool {
    let orch = state.orchestrator.read();
    orch.active_agents.contains_key(thread_id)
}

// ── Internal helpers ───────────────────────────────────────

/// Check whether we can launch a new agent (below concurrency limit).
fn can_launch(state: &AppState) -> bool {
    let orch = state.orchestrator.read();
    orch.active_agents.len() < orch.max_concurrent
}

/// Immediately launch an agent (no queueing).
async fn launch_immediate(
    app_handle: AppHandle,
    state: &AppState,
    config: &AgentLaunchConfig,
    thread_id: &str,
) -> AppResult<ThreadInfo> {
    let title = config.prompt.chars().take(100).collect::<String>();

    // Create worktree if requested
    let mut worktree_path: Option<String> = None;
    let mut worktree_branch: Option<String> = None;

    if config.use_worktree == Some(true) {
        let project = {
            let db = state.db.lock();
            project_queries::get_project(&db, &config.project_id).map_err(AppError::from)?
        };
        if let Some(ref project) = project {
            match worktree_manager::create(&project.path, thread_id, Some(&title)).await {
                Ok(wt) => {
                    worktree_path = Some(wt.path.clone());
                    worktree_branch = Some(wt.branch.clone());
                    info!(
                        target: "agent-orchestrator",
                        "Created worktree for agent {}: {}", thread_id, wt.path
                    );
                }
                Err(e) => {
                    warn!(
                        target: "agent-orchestrator",
                        "Failed to create worktree, running in main repo: {}", e
                    );
                }
            }
        }
    }

    // Determine CWD
    let project = {
        let db = state.db.lock();
        project_queries::get_project(&db, &config.project_id).map_err(AppError::from)?
    };
    let cwd = worktree_path
        .as_deref()
        .or(project.as_ref().map(|p| p.path.as_str()))
        .unwrap_or(".")
        .to_string();

    // Resolve permission mode and tool list
    let (app_settings, resolved_mode, resolved_tools) = {
        let db = state.db.lock();
        let settings = settings_queries::get_app_settings(&db).map_err(AppError::from)?;
        let (mode, tools) =
            resolve_permission_config(&settings, config.allowed_tools.as_deref());
        (settings, mode, tools)
    };

    let selected_provider = config
        .provider
        .as_ref()
        .map(|p| serde_json::to_string(p).unwrap_or_else(|_| "\"claude\"".into()))
        .unwrap_or_else(|| {
            app_settings
                .providers
                .as_ref()
                .map(|p| serde_json::to_string(&p.default_provider).unwrap_or_else(|_| "\"claude\"".into()))
                .unwrap_or_else(|| "\"claude\"".into())
        });

    let selected_model = config.model.clone();

    // Create thread in storage
    let thread = {
        let db = state.db.lock();
        let thread = thread_queries::create_thread(
            &db,
            thread_id,
            &config.project_id,
            Some(&title),
            None, // session_id
            worktree_path.as_deref(),
            worktree_branch.as_deref(),
            Some(&selected_provider.trim_matches('"')),
            selected_model.as_deref(),
        )
        .map_err(AppError::from)?;

        // Store user message
        let msg_id = uuid::Uuid::new_v4().to_string();
        let content = vec![MessageContent {
            content_type: "text".to_string(),
            text: Some(config.prompt.clone()),
            tool_name: None,
            tool_input: None,
            tool_output: None,
        }];
        message_queries::add_message(
            &db, &msg_id, thread_id, "user", &content, None, None, None, None,
        )
        .map_err(AppError::from)?;

        thread
    };

    let full_prompt =
        build_prompt_with_images(&config.prompt, config.image_paths.as_deref());

    // Spawn Claude CLI
    let spawn_result = claude_cli::spawn_claude(SpawnClaudeOptions {
        prompt: full_prompt,
        cwd,
        model: selected_model,
        resume_session_id: None,
        permission_mode: Some(resolved_mode),
        allowed_tools: Some(resolved_tools),
        disallowed_tools: Some(DISALLOWED_TOOLS.iter().map(|s| s.to_string()).collect()),
        append_system_prompt: Some(NON_INTERACTIVE_SYSTEM_PROMPT.to_string()),
        claude_path: app_settings.claude_cli_path.clone(),
    })
    .map_err(|e| AppError::Agent(format!("Failed to spawn Claude CLI: {}", e)))?;

    let events_rx = spawn_result.events_rx;
    let kill_tx = spawn_result.kill_tx;
    let stdin_tx = spawn_result.stdin_tx;

    // Register active agent
    let run_id = uuid::Uuid::new_v4().to_string();
    {
        let mut orch = state.orchestrator.write();
        orch.active_agents.insert(
            thread_id.to_string(),
            ActiveAgent {
                thread_id: thread_id.to_string(),
                project_id: config.project_id.clone(),
                run_id: run_id.clone(),
                cancel_tx: Some(kill_tx),
                stdin_tx: Some(stdin_tx),
                cost_usd: 0.0,
                tokens_in: 0,
                tokens_out: 0,
                model_usage: HashMap::new(),
            },
        );
    }

    // Emit launched event
    let _ = app_handle.emit("agent:status", (thread_id, "launched"));

    // Spawn background task to process events.
    // Retrieve AppState from AppHandle to avoid raw pointers across threads.
    let thread_id_owned = thread_id.to_string();
    let project_id_owned = config.project_id.clone();
    let app_handle_for_task = app_handle.clone();

    tokio::spawn(async move {
        let state_handle: tauri::State<'_, AppState> = app_handle_for_task.state();
        let state_ref: &AppState = &state_handle;
        let app_handle_inner = app_handle_for_task.clone();
        run_agent_events(
            app_handle_inner,
            state_ref,
            &thread_id_owned,
            &project_id_owned,
            &run_id,
            events_rx,
        )
        .await;
    });

    Ok(thread)
}

/// Core event processing loop shared by both `launch` and `send_message`.
///
/// Reads events from the CLI process, streams partial updates to the
/// renderer, handles session registration, cost tracking, and final
/// status updates.
async fn run_agent_events(
    app_handle: AppHandle,
    state: &AppState,
    thread_id: &str,
    project_id: &str,
    run_id: &str,
    mut events_rx: mpsc::Receiver<CliEvent>,
) {
    let mut received_result = false;
    let mut stream_state = StreamState::new();

    let result: Result<(), String> = async {
        while let Some(event) = events_rx.recv().await {
            match event.event_type.as_str() {
                "system" => {
                    if event.subtype.as_deref() == Some("init") {
                        if let Some(ref sid) = event.session_id {
                            session_registry::register(state, thread_id, sid);
                            let db = state.db.lock();
                            let _ =
                                thread_queries::update_thread_session(&db, thread_id, sid);
                            info!(
                                target: "agent-orchestrator",
                                "Agent {} started with session {}", thread_id, sid
                            );
                        }
                    }
                }

                "assistant" => {
                    process_assistant_event(
                        &app_handle,
                        thread_id,
                        &event,
                        &mut stream_state,
                    );
                }

                "result" => {
                    received_result = true;
                    process_result_event(
                        &app_handle,
                        state,
                        thread_id,
                        project_id,
                        &event,
                    );
                }

                "control_request" => {
                    handle_permission_request(&app_handle, thread_id, &event);
                }

                _ => {}
            }
        }

        Ok(())
    }
    .await;

    if let Err(e) = result {
        error!(
            target: "agent-orchestrator",
            "Agent {} error: {}", thread_id, e
        );
        let db = state.db.lock();
        let _ = thread_queries::update_thread_status(&db, thread_id, "failed");
        drop(db);

        let _ = app_handle.emit(
            "agent:error",
            (thread_id, serde_json::json!({
                "message": e,
            })),
        );
        let _ = app_handle.emit("agent:status", (thread_id, "failed"));
    }

    if !received_result {
        warn!(
            target: "agent-orchestrator",
            "Agent {} ended without a result event", thread_id
        );
        let db = state.db.lock();
        let _ = thread_queries::update_thread_status(&db, thread_id, "failed");
        drop(db);

        let _ = app_handle.emit("agent:status", (thread_id, "failed"));
        let _ = app_handle.emit(
            "agent:error",
            (thread_id, serde_json::json!({
                "message": "Agent process ended without producing a result",
            })),
        );
    }

    // Clean up active agent — only if this run still owns the slot.
    // A newer send_message may have replaced the entry; removing it
    // would drop the new kill_tx and instantly kill the new process.
    {
        let mut orch = state.orchestrator.write();
        if let Some(agent) = orch.active_agents.get(thread_id) {
            if agent.run_id == run_id {
                orch.active_agents.remove(thread_id);
            }
        }
    }

    // Process queue — if there are queued agents waiting for a slot, they
    // will pick up the available slot via their polling loop.
}

/// Process an `assistant` event: stream partial text and tool_use blocks
/// to the renderer with deduplication.
fn process_assistant_event(
    app_handle: &AppHandle,
    thread_id: &str,
    event: &CliEvent,
    state: &mut StreamState,
) {
    // Handle content_block partials (from --include-partial-messages)
    if let Some(ref cb) = event.content_block {
        if cb.block_type == "text" {
            if let Some(ref full_text) = cb.text {
                let delta = if state.last_seen_text_length < full_text.len() {
                    &full_text[state.last_seen_text_length..]
                } else {
                    ""
                };
                state.last_seen_text_length = full_text.len();

                if !delta.is_empty() {
                    let _ = app_handle.emit(
                        "agent:message",
                        (thread_id, serde_json::json!({
                            "type": "text",
                            "text": delta,
                            "blockIndex": state.current_block_index,
                        })),
                    );
                }
            }
        }

        if cb.block_type == "tool_use" {
            if let Some(ref name) = cb.name {
                let dedupe_key = cb
                    .id
                    .clone()
                    .unwrap_or_else(|| {
                        format!(
                            "{}-{}",
                            name,
                            cb.input
                                .as_ref()
                                .map(|v| v.to_string())
                                .unwrap_or_default()
                        )
                    });

                if !state.seen_tool_use_ids.contains(&dedupe_key) {
                    state.seen_tool_use_ids.insert(dedupe_key);
                    state.current_block_index += 1;
                    state.last_seen_text_length = 0;

                    let _ = app_handle.emit(
                        "agent:message",
                        (thread_id, serde_json::json!({
                            "type": "tool_use",
                            "toolName": name,
                            "toolInput": cb.input.as_ref().unwrap_or(&serde_json::json!({})),
                            "blockIndex": state.current_block_index,
                        })),
                    );

                    state.current_block_index += 1;
                }
            }
        }
    }

    // Handle full message.content snapshots
    let api_message = match &event.message {
        Some(m) => m,
        None => return,
    };

    if api_message.content.is_empty() {
        return;
    }

    for block in &api_message.content {
        if block.block_type == "text" {
            let full_text = block.text.as_deref().unwrap_or("");
            let delta = if state.last_seen_text_length < full_text.len() {
                &full_text[state.last_seen_text_length..]
            } else {
                ""
            };
            state.last_seen_text_length = full_text.len();

            if !delta.is_empty() {
                let _ = app_handle.emit(
                    "agent:message",
                    (thread_id, serde_json::json!({
                        "type": "text",
                        "text": delta,
                        "blockIndex": state.current_block_index,
                    })),
                );
            }
        } else if block.block_type == "tool_use" {
            let tool_id = block.id.as_deref().unwrap_or("");
            let tool_name = block.name.as_deref().unwrap_or("");
            let dedupe_key = if !tool_id.is_empty() {
                tool_id.to_string()
            } else {
                format!(
                    "{}-{}",
                    tool_name,
                    block
                        .input
                        .as_ref()
                        .map(|v| v.to_string())
                        .unwrap_or_default()
                )
            };

            if state.seen_tool_use_ids.contains(&dedupe_key) {
                continue;
            }
            state.seen_tool_use_ids.insert(dedupe_key);

            // New tool_use block: advance block index, reset text length
            state.current_block_index += 1;
            state.last_seen_text_length = 0;

            let _ = app_handle.emit(
                "agent:message",
                (thread_id, serde_json::json!({
                    "type": "tool_use",
                    "toolName": tool_name,
                    "toolInput": block.input.as_ref().unwrap_or(&serde_json::json!({})),
                    "blockIndex": state.current_block_index,
                })),
            );

            // Prepare for next text block after this tool
            state.current_block_index += 1;
        }
    }
}

/// Process a `result` event: compute cost deltas, store message, update
/// status, and notify the renderer.
///
/// Claude CLI's `total_cost_usd` and `modelUsage` are session-cumulative
/// when using `--resume`. This function computes the delta since the last
/// result for this thread by subtracting the previous cumulative snapshot.
fn process_result_event(
    app_handle: &AppHandle,
    state: &AppState,
    thread_id: &str,
    project_id: &str,
    event: &CliEvent,
) {
    // 1. Compute cost delta from cumulative total_cost_usd
    let cumulative_cost = event.total_cost_usd.unwrap_or(0.0);
    let prev_cost = {
        let orch = state.orchestrator.read();
        orch.previous_cumulative_cost
            .get(thread_id)
            .copied()
            .unwrap_or(0.0)
    };
    let mut delta_cost = (cumulative_cost - prev_cost).max(0.0);
    {
        let mut orch = state.orchestrator.write();
        orch.previous_cumulative_cost
            .insert(thread_id.to_string(), cumulative_cost);
    }

    // 2. Parse cumulative model usage from CLI event
    let cumulative_model_usage: Option<HashMap<String, ModelTokenUsage>> =
        event.model_usage.as_ref().map(|mu| {
            mu.iter()
                .map(|(model, u)| {
                    let input = u.input_tokens.unwrap_or(0);
                    let output = u.output_tokens.unwrap_or(0);
                    let cache_read = u.cache_read_input_tokens.unwrap_or(0);
                    let cache_create = u.cache_creation_input_tokens.unwrap_or(0);
                    let cli_cost = u.cost_usd.unwrap_or(0.0);

                    let cost = if cli_cost > 0.0 {
                        cli_cost
                    } else {
                        estimate_cost(
                            model,
                            input as u64,
                            output as u64,
                            cache_create as u64,
                            cache_read as u64,
                        )
                    };

                    (
                        model.clone(),
                        ModelTokenUsage {
                            input_tokens: input,
                            output_tokens: output,
                            cache_read_input_tokens: cache_read,
                            cache_creation_input_tokens: cache_create,
                            cost_usd: cost,
                        },
                    )
                })
                .collect()
        });

    // 3. Compute per-model delta
    let delta_model_usage = cumulative_model_usage
        .as_ref()
        .map(|cum| compute_model_usage_delta(state, thread_id, cum));

    // 4. Derive total token deltas from per-model delta breakdown
    let mut delta_tokens_in = event
        .usage
        .as_ref()
        .and_then(|u| u.input_tokens)
        .unwrap_or(0);
    let mut delta_tokens_out = event
        .usage
        .as_ref()
        .and_then(|u| u.output_tokens)
        .unwrap_or(0);

    if let Some(ref dmu) = delta_model_usage {
        let mut sum_in: i64 = 0;
        let mut sum_out: i64 = 0;
        for u in dmu.values() {
            sum_in += u.input_tokens
                + u.cache_read_input_tokens
                + u.cache_creation_input_tokens;
            sum_out += u.output_tokens;
        }
        if sum_in > 0 {
            delta_tokens_in = sum_in;
        }
        if sum_out > 0 {
            delta_tokens_out = sum_out;
        }
    }

    // 5. If CLI didn't provide total_cost_usd, sum estimated per-model costs
    if delta_cost == 0.0 {
        if let Some(ref dmu) = delta_model_usage {
            for u in dmu.values() {
                delta_cost += u.cost_usd;
            }
        }
    }

    // 6. Store assistant message in DB
    let primary_model = delta_model_usage
        .as_ref()
        .and_then(|m| m.keys().next().cloned());

    {
        let db = state.db.lock();
        let msg_id = uuid::Uuid::new_v4().to_string();
        let content = vec![MessageContent {
            content_type: "text".to_string(),
            text: Some(event.result.as_deref().unwrap_or("").to_string()),
            tool_name: None,
            tool_input: None,
            tool_output: None,
        }];
        let _ = message_queries::add_message(
            &db,
            &msg_id,
            thread_id,
            "assistant",
            &content,
            Some(delta_cost),
            Some(delta_tokens_in),
            Some(delta_tokens_out),
            primary_model.as_deref(),
        );

        if let Some(ref dmu) = delta_model_usage {
            let _ = model_usage_queries::add_model_usage(&db, thread_id, dmu);
        }
    }

    // 7. Track cost in orchestrator state
    track_cost(
        app_handle,
        state,
        thread_id,
        project_id,
        delta_cost,
        delta_tokens_in,
        delta_tokens_out,
        delta_model_usage.as_ref(),
    );

    // 8. Send cost and status messages to renderer
    let _ = app_handle.emit(
        "agent:message",
        (thread_id, serde_json::json!({
            "type": "cost",
            "costUsd": delta_cost,
            "tokensIn": delta_tokens_in,
            "tokensOut": delta_tokens_out,
            "modelUsage": delta_model_usage,
        })),
    );

    let is_success = event.subtype.as_deref() == Some("success");
    let final_status = if is_success { "completed" } else { "failed" };

    {
        let db = state.db.lock();
        let _ = thread_queries::update_thread_status(&db, thread_id, final_status);
    }

    let _ = app_handle.emit("agent:status", (thread_id, final_status));
    let _ = app_handle.emit(
        "agent:message",
        (thread_id, serde_json::json!({
            "type": "status",
            "status": final_status,
        })),
    );

    info!(
        target: "agent-orchestrator",
        "Agent {} finished: {} (delta ${:.4}, cumulative ${:.4})",
        thread_id,
        event.subtype.as_deref().unwrap_or("unknown"),
        delta_cost,
        cumulative_cost
    );
}

/// Compute per-model usage delta by subtracting the previous cumulative
/// snapshot. Updates the snapshot to the current cumulative values.
fn compute_model_usage_delta(
    state: &AppState,
    thread_id: &str,
    cumulative: &HashMap<String, ModelTokenUsage>,
) -> HashMap<String, ModelTokenUsage> {
    let prev = {
        let orch = state.orchestrator.read();
        orch.previous_cumulative_model_usage
            .get(thread_id)
            .cloned()
            .unwrap_or_default()
    };

    let mut delta: HashMap<String, ModelTokenUsage> = HashMap::new();

    for (model, usage) in cumulative {
        if let Some(p) = prev.get(model) {
            delta.insert(
                model.clone(),
                ModelTokenUsage {
                    input_tokens: (usage.input_tokens - p.input_tokens).max(0),
                    output_tokens: (usage.output_tokens - p.output_tokens).max(0),
                    cache_read_input_tokens: (usage.cache_read_input_tokens
                        - p.cache_read_input_tokens)
                        .max(0),
                    cache_creation_input_tokens: (usage.cache_creation_input_tokens
                        - p.cache_creation_input_tokens)
                        .max(0),
                    cost_usd: (usage.cost_usd - p.cost_usd).max(0.0),
                },
            );
        } else {
            delta.insert(model.clone(), usage.clone());
        }
    }

    // Save current cumulative as the new baseline (deep copy)
    let snapshot: HashMap<String, ModelTokenUsage> = cumulative
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    {
        let mut orch = state.orchestrator.write();
        orch.previous_cumulative_model_usage
            .insert(thread_id.to_string(), snapshot);
    }

    delta
}

/// Merge source model usage into target (accumulating values).
fn merge_model_usage(
    target: &mut HashMap<String, ModelTokenUsage>,
    source: &HashMap<String, ModelTokenUsage>,
) {
    for (model, usage) in source {
        let existing = target
            .entry(model.clone())
            .or_insert_with(ModelTokenUsage::default);
        existing.input_tokens += usage.input_tokens;
        existing.output_tokens += usage.output_tokens;
        existing.cache_read_input_tokens += usage.cache_read_input_tokens;
        existing.cache_creation_input_tokens += usage.cache_creation_input_tokens;
        existing.cost_usd += usage.cost_usd;
    }
}

/// Track cost for an agent in the orchestrator state and emit events.
fn track_cost(
    app_handle: &AppHandle,
    state: &AppState,
    thread_id: &str,
    project_id: &str,
    cost_usd: f64,
    tokens_in: i64,
    tokens_out: i64,
    model_usage: Option<&HashMap<String, ModelTokenUsage>>,
) {
    {
        let mut orch = state.orchestrator.write();

        // Update active agent stats
        if let Some(agent) = orch.active_agents.get_mut(thread_id) {
            agent.cost_usd += cost_usd;
            agent.tokens_in += tokens_in;
            agent.tokens_out += tokens_out;
            if let Some(mu) = model_usage {
                merge_model_usage(&mut agent.model_usage, mu);
            }
        }

        // Update project cost
        let project_cost = orch
            .project_costs
            .entry(project_id.to_string())
            .or_insert(0.0);
        *project_cost += cost_usd;

        // Update global model usage
        if let Some(mu) = model_usage {
            merge_model_usage(&mut orch.global_model_usage, mu);
        }
    }

    // Notify renderer for StatusBar immediate refresh
    let _ = app_handle.emit(
        "agent:cost",
        serde_json::json!({
            "threadId": thread_id,
            "threadCostUsd": cost_usd,
            "sessionCostUsd": 0,
        }),
    );
}

/// Handle a control_request (permission request) from the CLI.
fn handle_permission_request(
    app_handle: &AppHandle,
    thread_id: &str,
    event: &CliEvent,
) {
    let request_id = match &event.request_id {
        Some(id) => id.clone(),
        None => return,
    };
    let request = match &event.request {
        Some(r) => r,
        None => return,
    };

    let tool_name = request.tool_name.as_deref().unwrap_or("Unknown");
    let tool_input = request.input.as_ref().cloned().unwrap_or(serde_json::json!({}));

    // Build a human-readable description
    let description = match tool_name {
        "Bash" => tool_input
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Write" | "Edit" | "Read" => tool_input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    };

    info!(
        target: "agent-orchestrator",
        "Permission request for {}: {} ({})", thread_id, tool_name, request_id
    );

    let _ = app_handle.emit(
        "agent:message",
        (thread_id, serde_json::json!({
            "type": "permission_request",
            "requestId": request_id,
            "toolName": tool_name,
            "toolInput": tool_input,
            "toolDescription": description,
        })),
    );
}

/// Resolve permission mode and allowed tools from app settings.
///
/// Returns `(permission_mode_string, allowed_tools_vec)`.
fn resolve_permission_config(
    settings: &AppSettings,
    config_allowed_tools: Option<&[String]>,
) -> (String, Vec<String>) {
    let default_tools: Vec<String> = DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect();

    match settings.permission_mode.as_str() {
        "full" => ("bypassPermissions".to_string(), default_tools),
        "ask" => {
            let tools = if let Some(tools) = config_allowed_tools {
                if !tools.is_empty() {
                    tools.to_vec()
                } else {
                    default_tools
                }
            } else {
                default_tools
            };
            ("default".to_string(), tools)
        }
        "acceptEdits" => ("acceptEdits".to_string(), default_tools),
        _ => ("bypassPermissions".to_string(), default_tools),
    }
}

/// Build a copilot system prompt for a given CWD.
#[allow(dead_code)]
pub(crate) fn build_copilot_system_prompt(cwd: &str) -> String {
    format!(
        "You are a powerful agentic coding assistant. You MUST use the provided tools to accomplish tasks.\n\
         NEVER just describe what you would do — actually do it by calling tools.\n\
         \n\
         Available tools: Read (read files), Write (create/overwrite files), Edit (replace strings in files),\n\
         Bash (run shell commands), Glob (find files by pattern), Grep (search file contents).\n\
         \n\
         Workflow:\n\
         1. Use Glob/Grep/Read to understand the codebase first.\n\
         2. Use Edit/Write to make changes.\n\
         3. Use Bash to run tests, builds, or other commands as needed.\n\
         \n\
         Current working directory: {}\n\
         \n\
         IMPORTANT: Always use tools. Do NOT just respond with text describing what you would do.\n\
         If the user asks you to change code, READ the file first, then EDIT it. Always act, never just explain.",
        cwd
    )
}

/// Build a prompt that includes image file path references for the CLI.
fn build_prompt_with_images(prompt: &str, image_paths: Option<&[String]>) -> String {
    match image_paths {
        Some(paths) if !paths.is_empty() => {
            let image_refs: String = paths
                .iter()
                .map(|p| format!("[Image: {}]", p.replace('\\', "/")))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{}\n\n{}", image_refs, prompt)
        }
        _ => prompt.to_string(),
    }
}
