use tauri::AppHandle;

use crate::services::terminal_service;
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// Create a new terminal session with a real PTY.
#[tauri::command]
pub fn terminal_create(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    terminal_service::create(&app_handle, &state, &id, &cwd).map_err(|e| e.to_string())
}

/// Write input data to a terminal session.
#[tauri::command]
pub fn terminal_write(
    state: tauri::State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    terminal_service::write(&state, &id, data.as_bytes()).map_err(|e| e.to_string())
}

/// Resize a terminal session.
#[tauri::command]
pub fn terminal_resize(
    state: tauri::State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminal_service::resize(&state, &id, cols, rows).map_err(|e| e.to_string())
}

/// Destroy a terminal session.
#[tauri::command]
pub fn terminal_destroy(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    terminal_service::destroy(&state, &id);
    Ok(())
}

/// List all active terminal session IDs.
#[tauri::command]
pub fn terminal_list(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    Ok(terminal_service::get_active_ids(&state))
}
