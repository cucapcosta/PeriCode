use tauri::AppHandle;
use tracing::info;

use crate::db::models::{Project, ProjectDetectionInfo, ProjectSettings};
use crate::db::queries::projects as project_queries;
use crate::services::project_manager;
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// List all projects ordered by last opened.
#[tauri::command]
pub fn project_list(state: tauri::State<'_, AppState>) -> Result<Vec<Project>, String> {
    let db = state.db.lock();
    project_queries::list_projects(&db).map_err(|e| e.to_string())
}

/// Add a new project by path.
#[tauri::command]
pub fn project_add(state: tauri::State<'_, AppState>, path: String) -> Result<Project, String> {
    let db = state.db.lock();
    project_manager::add_project(&db, &path).map_err(|e| e.to_string())
}

/// Remove a project and all related data.
#[tauri::command]
pub fn project_remove(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock();
    project_queries::remove_project(&db, &id).map_err(|e| e.to_string())
}

/// Get settings for a specific project.
#[tauri::command]
pub fn project_get_settings(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<ProjectSettings, String> {
    let db = state.db.lock();
    let project = project_queries::get_project(&db, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Project not found: {}", id))?;
    Ok(project.settings)
}

/// Update settings for a specific project (merge-update).
#[tauri::command]
pub fn project_update_settings(
    state: tauri::State<'_, AppState>,
    id: String,
    settings: serde_json::Value,
) -> Result<(), String> {
    let db = state.db.lock();
    let parsed: ProjectSettings =
        serde_json::from_value(settings).map_err(|e| e.to_string())?;
    project_queries::update_project_settings(&db, &id, &parsed).map_err(|e| e.to_string())
}

/// Open a native folder picker and add the selected project.
#[tauri::command]
pub async fn project_open_folder(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<Project>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app_handle
        .dialog()
        .file()
        .set_title("Open Project Folder")
        .blocking_pick_folder();

    let folder = match folder {
        Some(f) => f,
        None => return Ok(None),
    };

    let path_str = folder
        .as_path()
        .ok_or_else(|| "Invalid folder path".to_string())?
        .to_string_lossy()
        .to_string();

    info!(target: "commands::projects", "User picked folder: {}", path_str);

    let db = state.db.lock();
    let project = project_manager::add_project(&db, &path_str).map_err(|e| e.to_string())?;
    Ok(Some(project))
}

/// Detect project info (git repo, CLAUDE.md, etc.).
#[tauri::command]
pub fn project_detect_info(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<ProjectDetectionInfo, String> {
    let db = state.db.lock();
    let project = project_queries::get_project(&db, &project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Project not found: {}", project_id))?;
    drop(db);

    Ok(project_manager::detect_project_info(&project.path))
}
