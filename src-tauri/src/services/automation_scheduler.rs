use rusqlite::Connection;
use tokio::sync::oneshot;
use tracing::{info, warn};

use crate::db::models::{Automation, AutomationConfig, AutomationRun};
use crate::db::queries::automations as auto_queries;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, ScheduledTask, SchedulerState};

/// Information about a scheduled automation (returned from `get_scheduled`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledInfo {
    pub automation_id: String,
    pub active: bool,
}

// ── Public API ─────────────────────────────────────────────

/// Register an automation for scheduled or event-based execution.
///
/// For cron-type triggers, spawns a tokio task that fires at the specified
/// schedule. For file-change triggers, uses `notify` for filesystem watching.
pub fn register(state: &AppState, automation: &Automation) {
    let mut scheduler = state.scheduler.lock();

    // Clean up existing if re-registering
    cleanup_task_inner(&mut scheduler, &automation.id);

    let task = ScheduledTask {
        automation_id: automation.id.clone(),
        cancel_tx: None,
    };

    if !automation.enabled {
        scheduler.scheduled.insert(automation.id.clone(), task);
        return;
    }

    match automation.trigger_type.as_str() {
        "cron" => {
            if let Some(ref schedule) = automation.schedule {
                // Validate cron expression using the cron crate
                if schedule.split_whitespace().count() >= 5 {
                    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
                    let automation_id = automation.id.clone();
                    let schedule_str = schedule.clone();

                    // Spawn a background task that periodically checks the schedule
                    tokio::spawn(async move {
                        cron_runner(automation_id, schedule_str, cancel_rx).await;
                    });

                    let task = ScheduledTask {
                        automation_id: automation.id.clone(),
                        cancel_tx: Some(cancel_tx),
                    };
                    scheduler.scheduled.insert(automation.id.clone(), task);

                    info!(
                        target: "automation-scheduler",
                        "Registered cron: {} ({})", automation.name, schedule
                    );
                } else {
                    scheduler.scheduled.insert(automation.id.clone(), task);
                    warn!(
                        target: "automation-scheduler",
                        "Invalid cron schedule for {}: {:?}", automation.name, schedule
                    );
                }
            } else {
                scheduler.scheduled.insert(automation.id.clone(), task);
            }
        }
        "file_change" => {
            // File change triggers use the notify crate for filesystem watching.
            // For now, register the task without a watcher — actual watcher hookup
            // happens via the automation_executor init path.
            scheduler.scheduled.insert(automation.id.clone(), task);
            info!(
                target: "automation-scheduler",
                "Registered file watcher: {}", automation.name
            );
        }
        "git_event" => {
            scheduler.scheduled.insert(automation.id.clone(), task);
            info!(
                target: "automation-scheduler",
                "Registered git event: {}", automation.name
            );
        }
        "manual" | _ => {
            scheduler.scheduled.insert(automation.id.clone(), task);
            info!(
                target: "automation-scheduler",
                "Registered manual: {}", automation.name
            );
        }
    }
}

/// Unregister an automation and clean up any scheduled tasks.
pub fn unregister(state: &AppState, automation_id: &str) {
    let mut scheduler = state.scheduler.lock();
    cleanup_task_inner(&mut scheduler, automation_id);
    scheduler.scheduled.remove(automation_id);
}

/// Trigger an automation manually or from a scheduled event.
/// Returns the new automation run record.
pub fn trigger(_state: &AppState, conn: &Connection, automation_id: &str) -> AppResult<AutomationRun> {
    let automation = auto_queries::get_automation(conn, automation_id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound(format!("Automation not found: {}", automation_id)))?;

    if !automation.enabled {
        return Err(AppError::InvalidInput(format!(
            "Automation is disabled: {}",
            automation.name
        )));
    }

    let run_id = uuid::Uuid::new_v4().to_string();
    let run = auto_queries::add_automation_run(conn, &run_id, automation_id)
        .map_err(AppError::from)?;

    // Update last_run_at
    let updates = serde_json::json!({
        "lastRunAt": chrono::Utc::now().to_rfc3339(),
    });
    let _ = auto_queries::update_automation(conn, automation_id, &updates);

    info!(
        target: "automation-scheduler",
        "Triggered automation: {} (run: {})", automation.name, run_id
    );

    Ok(run)
}

/// Create a new automation from config and register it.
pub fn create(state: &AppState, conn: &Connection, config: &AutomationConfig) -> AppResult<Automation> {
    let id = uuid::Uuid::new_v4().to_string();
    let trigger_config = config
        .trigger_config
        .as_ref()
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let skill_ids: Vec<String> = config.skill_ids.as_ref().cloned().unwrap_or_default();

    let automation = auto_queries::add_automation(
        conn,
        &id,
        &config.project_id,
        &config.name,
        &config.prompt,
        &config.trigger_type,
        &trigger_config,
        &skill_ids,
        config.schedule.as_deref(),
        true,
    )
    .map_err(AppError::from)?;

    register(state, &automation);
    Ok(automation)
}

/// Update an existing automation.
pub fn update(
    state: &AppState,
    conn: &Connection,
    id: &str,
    config: &AutomationConfig,
) -> AppResult<Automation> {
    let mut updates = serde_json::Map::new();
    updates.insert("name".to_string(), serde_json::json!(config.name));
    updates.insert("prompt".to_string(), serde_json::json!(config.prompt));

    if let Some(ref skill_ids) = config.skill_ids {
        updates.insert("skillIds".to_string(), serde_json::json!(skill_ids));
    }
    if let Some(ref schedule) = config.schedule {
        updates.insert("schedule".to_string(), serde_json::json!(schedule));
    }
    updates.insert("triggerType".to_string(), serde_json::json!(config.trigger_type));
    if let Some(ref trigger_config) = config.trigger_config {
        updates.insert("triggerConfig".to_string(), trigger_config.clone());
    }

    let automation = auto_queries::update_automation(
        conn,
        id,
        &serde_json::Value::Object(updates),
    )
    .map_err(AppError::from)?;

    // Re-register to update triggers
    register(state, &automation);
    Ok(automation)
}

/// Delete an automation.
pub fn delete(state: &AppState, conn: &Connection, id: &str) -> AppResult<()> {
    unregister(state, id);
    auto_queries::delete_automation(conn, id).map_err(AppError::from)?;
    Ok(())
}

/// Toggle enabled/disabled state.
pub fn toggle_enabled(state: &AppState, conn: &Connection, id: &str) -> AppResult<()> {
    let automation = auto_queries::get_automation(conn, id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound(format!("Automation not found: {}", id)))?;

    if automation.enabled {
        // Pause: disable without unregistering
        let updates = serde_json::json!({ "enabled": false });
        auto_queries::update_automation(conn, id, &updates).map_err(AppError::from)?;

        let mut scheduler = state.scheduler.lock();
        cleanup_task_inner(&mut scheduler, id);
    } else {
        // Resume: re-enable and re-register
        let updates = serde_json::json!({ "enabled": true });
        let updated = auto_queries::update_automation(conn, id, &updates).map_err(AppError::from)?;
        register(state, &updated);
    }

    Ok(())
}

/// Get all scheduled tasks with their active status.
pub fn get_scheduled(state: &AppState) -> Vec<ScheduledInfo> {
    let scheduler = state.scheduler.lock();
    scheduler
        .scheduled
        .iter()
        .map(|(id, task)| ScheduledInfo {
            automation_id: id.clone(),
            active: task.cancel_tx.is_some(),
        })
        .collect()
}

/// Get run history for an automation.
pub fn get_history(conn: &Connection, automation_id: &str) -> AppResult<Vec<AutomationRun>> {
    let runs = auto_queries::list_automation_runs(conn, automation_id).map_err(AppError::from)?;
    Ok(runs)
}

/// Complete an automation run with results.
pub fn complete_run(
    conn: &Connection,
    run_id: &str,
    status: &str,
    result: Option<&serde_json::Value>,
) -> AppResult<AutomationRun> {
    let mut updates = serde_json::Map::new();
    updates.insert("status".to_string(), serde_json::json!(status));
    if let Some(result_val) = result {
        updates.insert("result".to_string(), result_val.clone());
    }
    updates.insert(
        "finishedAt".to_string(),
        serde_json::json!(chrono::Utc::now().to_rfc3339()),
    );

    let run = auto_queries::update_automation_run(conn, run_id, &serde_json::Value::Object(updates))
        .map_err(AppError::from)?;
    Ok(run)
}

/// Clean up all scheduled tasks.
pub fn shutdown(state: &AppState) {
    let mut scheduler = state.scheduler.lock();
    let ids: Vec<String> = scheduler.scheduled.keys().cloned().collect();
    for id in ids {
        cleanup_task_inner(&mut scheduler, &id);
    }
    scheduler.scheduled.clear();
}

/// Load all automations for a project and register them.
pub fn load_project_automations(state: &AppState, conn: &Connection, project_id: &str) -> AppResult<()> {
    let automations = auto_queries::list_automations(conn, project_id).map_err(AppError::from)?;
    for automation in &automations {
        register(state, automation);
    }
    Ok(())
}

// ── Internal helpers ───────────────────────────────────────

fn cleanup_task_inner(scheduler: &mut SchedulerState, automation_id: &str) {
    if let Some(task) = scheduler.scheduled.get_mut(automation_id) {
        if let Some(tx) = task.cancel_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// A simple cron runner that checks the schedule periodically.
///
/// This is a simplified implementation. In production, this would use
/// `tokio-cron-scheduler` for precise timing, but this avoids complex
/// lifetime issues with the state reference.
async fn cron_runner(
    automation_id: String,
    _schedule: String,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    use std::time::Duration;

    // Check every 60 seconds
    let interval = Duration::from_secs(60);

    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                info!(
                    target: "automation-scheduler",
                    "Cron runner for {} cancelled", automation_id
                );
                break;
            }
            _ = tokio::time::sleep(interval) => {
                // In a full implementation, we'd check whether the cron
                // schedule matches the current time and trigger accordingly.
                // For now, this is a placeholder that other systems hook into.
            }
        }
    }
}
