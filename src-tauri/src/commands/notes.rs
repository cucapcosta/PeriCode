use crate::db::queries::notes as notes_queries;
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// Get the note content for a thread.
#[tauri::command]
pub fn notes_get(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<Option<String>, String> {
    let db = state.db.lock();
    notes_queries::get_thread_note(&db, &thread_id).map_err(|e| e.to_string())
}

/// Save (upsert) a note for a thread.
#[tauri::command]
pub fn notes_save(
    state: tauri::State<'_, AppState>,
    thread_id: String,
    content: String,
) -> Result<(), String> {
    let db = state.db.lock();
    notes_queries::save_thread_note(&db, &thread_id, &content).map_err(|e| e.to_string())
}

/// Delete the note for a thread.
#[tauri::command]
pub fn notes_delete(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<(), String> {
    let db = state.db.lock();
    notes_queries::delete_thread_note(&db, &thread_id).map_err(|e| e.to_string())
}
