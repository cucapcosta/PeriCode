use crate::db::models::{AppNotification, StatusInfo};
use crate::services::{agent_orchestrator, notification_service};
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// Get the current application status overview.
#[tauri::command]
pub fn status_get_info(state: tauri::State<'_, AppState>) -> Result<StatusInfo, String> {
    let running_count = agent_orchestrator::get_running_agents_count(&state) as i32;
    let queued_count = agent_orchestrator::get_queued_count(&state) as i32;
    let total_cost = agent_orchestrator::get_total_cost(&state);
    let model_usage = agent_orchestrator::get_global_model_usage(&state);

    // Aggregate total tokens from model usage
    let mut total_tokens_in: i64 = 0;
    let mut total_tokens_out: i64 = 0;
    for usage in model_usage.values() {
        total_tokens_in += usage.input_tokens;
        total_tokens_out += usage.output_tokens;
    }

    // Detect CLI availability
    let cli_available;
    let cli_version;
    match std::process::Command::new("claude").args(["--version"]).output() {
        Ok(output) if output.status.success() => {
            cli_available = true;
            let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
            cli_version = if v.is_empty() { None } else { Some(v) };
        }
        _ => {
            cli_available = false;
            cli_version = None;
        }
    }

    // Count active automations
    let active_automations = {
        let scheduler = state.scheduler.lock();
        scheduler.scheduled.len() as i32
    };

    Ok(StatusInfo {
        running_agents: running_count,
        queued_agents: queued_count,
        total_cost_usd: total_cost,
        total_tokens_in,
        total_tokens_out,
        model_usage,
        cli_available,
        cli_version,
        active_automations,
        next_automation_run: None, // TODO: compute from scheduler state
    })
}

/// Get the notification history.
#[tauri::command]
pub fn notification_get_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AppNotification>, String> {
    Ok(notification_service::get_history(&state))
}

/// Clear all notification history.
#[tauri::command]
pub fn notification_clear(state: tauri::State<'_, AppState>) -> Result<(), String> {
    notification_service::clear_history(&state);
    Ok(())
}
