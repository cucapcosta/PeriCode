use tauri::AppHandle;

use crate::db::models::{AgentLaunchConfig, PermissionResponse, ThreadInfo};
use crate::db::queries::threads as thread_queries;
use crate::services::agent_orchestrator;
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// Launch a new agent with the given configuration.
#[tauri::command]
pub async fn agent_launch(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    config: AgentLaunchConfig,
) -> Result<ThreadInfo, String> {
    agent_orchestrator::launch(app_handle, &state, config)
        .await
        .map_err(|e| e.to_string())
}

/// Pause a running agent (updates status to "paused").
///
/// Note: Claude CLI does not natively support pause/resume. This sets the
/// thread status so the UI reflects the intent. A full implementation would
/// signal the agent process to suspend.
#[tauri::command]
pub fn agent_pause(state: tauri::State<'_, AppState>, thread_id: String) -> Result<(), String> {
    let db = state.db.lock();
    thread_queries::update_thread_status(&db, &thread_id, "paused").map_err(|e| e.to_string())
}

/// Resume a paused agent (updates status back to "running").
#[tauri::command]
pub fn agent_resume(state: tauri::State<'_, AppState>, thread_id: String) -> Result<(), String> {
    let db = state.db.lock();
    thread_queries::update_thread_status(&db, &thread_id, "running").map_err(|e| e.to_string())
}

/// Cancel a running or queued agent.
#[tauri::command]
pub fn agent_cancel(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<(), String> {
    agent_orchestrator::cancel(&state, &thread_id);
    // Emit status change so the frontend updates immediately
    let _ = app_handle.emit("agent:status", (&thread_id, "failed"));
    Ok(())
}

/// Send a follow-up message to an existing agent thread.
#[tauri::command]
pub async fn agent_send_message(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    thread_id: String,
    message: String,
    image_paths: Option<Vec<String>>,
) -> Result<(), String> {
    let paths_ref = image_paths.as_deref();
    agent_orchestrator::send_message(app_handle, &state, &thread_id, &message, paths_ref)
        .await
        .map_err(|e| e.to_string())
}

/// Respond to a permission request from a running agent.
#[tauri::command]
pub fn agent_respond_permission(
    state: tauri::State<'_, AppState>,
    response: PermissionResponse,
) -> Result<(), String> {
    agent_orchestrator::respond_permission(&state, &response);
    Ok(())
}

/// Get info for all currently running agents.
#[tauri::command]
pub fn agent_get_running(state: tauri::State<'_, AppState>) -> Result<Vec<ThreadInfo>, String> {
    let running_ids = agent_orchestrator::get_running_thread_ids(&state);

    if running_ids.is_empty() {
        return Ok(Vec::new());
    }

    let db = state.db.lock();
    let mut threads = Vec::new();
    for id in &running_ids {
        if let Ok(Some(thread)) = thread_queries::get_thread(&db, id) {
            threads.push(thread);
        }
    }
    Ok(threads)
}

use tauri::Emitter;
