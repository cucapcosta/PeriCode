use crate::db::models::{
    Automation, AutomationConfig, AutomationRun, AutomationTemplate, InboxFilters,
};
use crate::db::queries::automations as auto_queries;
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// List all automations for a project.
#[tauri::command]
pub fn automation_list(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Automation>, String> {
    let db = state.db.lock();
    auto_queries::list_automations(&db, &project_id).map_err(|e| e.to_string())
}

/// Create a new automation.
#[tauri::command]
pub fn automation_create(
    state: tauri::State<'_, AppState>,
    config: AutomationConfig,
) -> Result<Automation, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let skill_ids = config.skill_ids.clone().unwrap_or_default();
    let trigger_config = config
        .trigger_config
        .clone()
        .unwrap_or(serde_json::json!({}));

    let db = state.db.lock();
    let automation = auto_queries::add_automation(
        &db,
        &id,
        &config.project_id,
        &config.name,
        &config.prompt,
        &config.trigger_type,
        &trigger_config,
        &skill_ids,
        config.schedule.as_deref(),
        true, // enabled by default
    )
    .map_err(|e| e.to_string())?;

    // Register with scheduler
    drop(db);
    crate::services::automation_scheduler::register(&state, &automation);

    Ok(automation)
}

/// Update an existing automation with partial fields.
#[tauri::command]
pub fn automation_update(
    state: tauri::State<'_, AppState>,
    id: String,
    config: serde_json::Value,
) -> Result<Automation, String> {
    let db = state.db.lock();
    let automation = auto_queries::update_automation(&db, &id, &config).map_err(|e| e.to_string())?;

    // Re-register with scheduler after update
    drop(db);
    crate::services::automation_scheduler::register(&state, &automation);

    Ok(automation)
}

/// Delete an automation and its run history.
#[tauri::command]
pub fn automation_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock();
    auto_queries::delete_automation(&db, &id).map_err(|e| e.to_string())
}

/// Manually trigger an automation run.
#[tauri::command]
pub fn automation_trigger(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<AutomationRun, String> {
    let run_id = uuid::Uuid::new_v4().to_string();
    let db = state.db.lock();

    // Verify automation exists
    let _automation = auto_queries::get_automation(&db, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Automation not found: {}", id))?;

    let run = auto_queries::add_automation_run(&db, &run_id, &id).map_err(|e| e.to_string())?;

    // Update last_run_at
    let now = chrono::Utc::now().to_rfc3339();
    let update = serde_json::json!({ "lastRunAt": now });
    let _ = auto_queries::update_automation(&db, &id, &update);

    Ok(run)
}

/// Toggle the enabled state of an automation.
#[tauri::command]
pub fn automation_toggle_enabled(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let db = state.db.lock();
    let automation = auto_queries::get_automation(&db, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Automation not found: {}", id))?;

    let new_enabled = !automation.enabled;
    let update = serde_json::json!({ "enabled": new_enabled });
    let updated = auto_queries::update_automation(&db, &id, &update).map_err(|e| e.to_string())?;

    // Re-register with scheduler
    drop(db);
    crate::services::automation_scheduler::register(&state, &updated);

    Ok(())
}

/// Get the run history for an automation.
#[tauri::command]
pub fn automation_get_history(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<AutomationRun>, String> {
    let db = state.db.lock();
    auto_queries::list_automation_runs(&db, &id).map_err(|e| e.to_string())
}

/// Get the automation inbox (all runs with optional filters).
#[tauri::command]
pub fn automation_get_inbox(
    state: tauri::State<'_, AppState>,
    filters: Option<InboxFilters>,
) -> Result<Vec<AutomationRun>, String> {
    let filters = filters.unwrap_or_default();
    let db = state.db.lock();
    auto_queries::list_inbox_runs(&db, &filters).map_err(|e| e.to_string())
}

/// Mark an automation run as read.
#[tauri::command]
pub fn automation_mark_read(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<(), String> {
    let db = state.db.lock();
    let update = serde_json::json!({ "read": true });
    auto_queries::update_automation_run(&db, &run_id, &update).map_err(|e| e.to_string())?;
    Ok(())
}

/// Archive an automation run (mark as read + archived status).
#[tauri::command]
pub fn automation_archive_run(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<(), String> {
    let db = state.db.lock();
    let update = serde_json::json!({ "read": true, "status": "archived" });
    auto_queries::update_automation_run(&db, &run_id, &update).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get built-in automation templates.
#[tauri::command]
pub fn automation_get_templates() -> Result<Vec<AutomationTemplate>, String> {
    Ok(vec![
        AutomationTemplate {
            name: "Code Review on Push".to_string(),
            description: "Automatically review code changes when files are pushed.".to_string(),
            prompt: "Review the latest changes for code quality, potential bugs, and adherence to best practices. Provide a summary with actionable feedback.".to_string(),
            trigger_type: "file_change".to_string(),
            schedule: None,
            trigger_config: serde_json::json!({
                "patterns": ["**/*.rs", "**/*.ts", "**/*.tsx"],
                "ignorePatterns": ["**/node_modules/**", "**/target/**"]
            }),
            skill_ids: Vec::new(),
        },
        AutomationTemplate {
            name: "Daily Test Suite".to_string(),
            description: "Run the test suite every morning and report failures.".to_string(),
            prompt: "Run the project's test suite. If any tests fail, analyze the failures and suggest fixes. Provide a summary of test results.".to_string(),
            trigger_type: "cron".to_string(),
            schedule: Some("0 8 * * *".to_string()),
            trigger_config: serde_json::json!({}),
            skill_ids: Vec::new(),
        },
        AutomationTemplate {
            name: "Dependency Update Check".to_string(),
            description: "Weekly check for outdated dependencies.".to_string(),
            prompt: "Check for outdated dependencies in the project. List any that have updates available, note if they are major/minor/patch, and flag any with known security vulnerabilities.".to_string(),
            trigger_type: "cron".to_string(),
            schedule: Some("0 9 * * 1".to_string()),
            trigger_config: serde_json::json!({}),
            skill_ids: Vec::new(),
        },
        AutomationTemplate {
            name: "Documentation Sync".to_string(),
            description: "Update documentation when source files change.".to_string(),
            prompt: "Check if the documentation is in sync with the source code. Update any outdated API docs, README sections, or inline documentation that no longer reflects the current implementation.".to_string(),
            trigger_type: "file_change".to_string(),
            schedule: None,
            trigger_config: serde_json::json!({
                "patterns": ["src/**/*"],
                "ignorePatterns": ["**/*.test.*", "**/*.spec.*"]
            }),
            skill_ids: Vec::new(),
        },
    ])
}
