use serde::{Deserialize, Serialize};

use crate::db::models::{Skill, SkillDefinition, SkillDetail};
use crate::services::skills_engine;
use crate::state::AppState;

// ── Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExportResult {
    pub name: String,
    pub path: String,
    pub content: String,
}

// ── Commands ──────────────────────────────────────────────────

/// List all available skills (system + user + project).
#[tauri::command]
pub fn skill_list(state: tauri::State<'_, AppState>) -> Result<Vec<Skill>, String> {
    let db = state.db.lock();
    skills_engine::load_all(&db).map_err(|e| e.to_string())
}

/// Get detailed information about a skill including its content.
#[tauri::command]
pub fn skill_get(state: tauri::State<'_, AppState>, id: String) -> Result<SkillDetail, String> {
    let db = state.db.lock();
    skills_engine::get_detail(&db, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {}", id))
}

/// Create a new user skill.
#[tauri::command]
pub fn skill_create(
    state: tauri::State<'_, AppState>,
    definition: SkillDefinition,
) -> Result<Skill, String> {
    let db = state.db.lock();
    skills_engine::create(&db, &definition).map_err(|e| e.to_string())
}

/// Update an existing skill.
#[tauri::command]
pub fn skill_update(
    state: tauri::State<'_, AppState>,
    id: String,
    definition: SkillDefinition,
) -> Result<Skill, String> {
    let db = state.db.lock();
    skills_engine::update(&db, &id, &definition).map_err(|e| e.to_string())
}

/// Delete a skill.
#[tauri::command]
pub fn skill_delete(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock();
    skills_engine::delete(&db, &id).map_err(|e| e.to_string())
}

/// Export a skill's content for sharing.
#[tauri::command]
pub fn skill_export(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<SkillExportResult, String> {
    let db = state.db.lock();
    let detail = skills_engine::get_detail(&db, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {}", id))?;

    Ok(SkillExportResult {
        name: detail.skill.name,
        path: detail.skill.path,
        content: detail.content,
    })
}

/// Import a skill from a local archive/directory path.
#[tauri::command]
pub fn skill_import(
    state: tauri::State<'_, AppState>,
    archive_path: String,
) -> Result<Skill, String> {
    use crate::services::skill_parser::load_skill_file;

    let skill_file = std::path::Path::new(&archive_path).join("SKILL.md");
    let skill_file_str = skill_file.to_string_lossy().to_string();

    let parsed = load_skill_file(&skill_file_str)
        .ok_or_else(|| format!("No valid SKILL.md found at {}", archive_path))?;

    let definition = SkillDefinition {
        name: parsed.name,
        description: parsed.description,
        content: parsed.instructions,
        scope: "user".to_string(),
        model: parsed.model,
        tools: parsed.tools,
        max_budget_usd: parsed.max_budget_usd,
    };

    let db = state.db.lock();
    skills_engine::create(&db, &definition).map_err(|e| e.to_string())
}

/// Import skills from a Git repository URL.
///
/// `skills_engine::import_from_git` is async (uses tokio::process::Command
/// for git clone) and takes `&Connection`. Since rusqlite::Connection is
/// !Send, the future cannot cross thread boundaries. We work around this
/// by running the entire operation inside `spawn_blocking` with a dedicated
/// connection and using `block_on` for the async subprocess work.
#[tauri::command]
pub async fn skill_import_from_git(
    _state: tauri::State<'_, AppState>,
    git_url: String,
) -> Result<Vec<Skill>, String> {
    let db_path = crate::utils::paths::get_database_path();
    let db_path_str = db_path.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        let conn = rusqlite::Connection::open(&db_path_str)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let rt = tokio::runtime::Handle::current();
        rt.block_on(skills_engine::import_from_git(&conn, &git_url))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
