use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tracing::{info, warn};

use crate::db::models::{Skill, SkillDefinition, SkillDetail};
use crate::db::queries::skills as skill_queries;
use crate::error::{AppError, AppResult};
use crate::utils::paths::get_skills_path;

use super::skill_parser::{
    load_skill_file, scan_skills_directory, write_skill_file, ParsedSkillDefinition,
};

/// Configuration generated from a skill for use with an agent.
#[derive(Debug, Clone)]
pub struct SkillConfig {
    pub system_prompt: String,
    pub tools: Vec<String>,
    pub model: Option<String>,
    pub max_budget_usd: Option<f64>,
}

/// Path to built-in skills shipped with the app.
fn builtin_skills_path() -> PathBuf {
    // In a Tauri app, built-in resources are resolved relative to the binary
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("skills")
}

/// Load all skills from all scopes: system (built-in), user, project.
pub fn load_all(conn: &Connection) -> AppResult<Vec<Skill>> {
    let mut skills: Vec<Skill> = Vec::new();

    // 1. Load system (built-in) skills
    let builtin_path = builtin_skills_path();
    let builtin_path_str = builtin_path.to_string_lossy().to_string();
    let builtin_scanned = scan_skills_directory(&builtin_path_str);
    let stored_skills = skill_queries::list_skills(conn)?;

    for scanned in &builtin_scanned {
        let existing = stored_skills
            .iter()
            .find(|s| s.name == scanned.parsed.name && s.scope == "system");
        if let Some(existing) = existing {
            skills.push(existing.clone());
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            let skill = skill_queries::add_skill(
                conn,
                &id,
                &scanned.parsed.name,
                &scanned.parsed.description,
                "system",
                &scanned.path,
            )?;
            skills.push(skill);
        }
    }

    // 2. Load user skills
    let user_skills_path = get_skills_path();
    let user_skills_path_str = user_skills_path.to_string_lossy().to_string();
    let user_scanned = scan_skills_directory(&user_skills_path_str);

    for scanned in &user_scanned {
        let existing = stored_skills
            .iter()
            .find(|s| s.name == scanned.parsed.name && s.scope == "user");
        if let Some(existing) = existing {
            skills.push(existing.clone());
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            let skill = skill_queries::add_skill(
                conn,
                &id,
                &scanned.parsed.name,
                &scanned.parsed.description,
                "user",
                &scanned.path,
            )?;
            skills.push(skill);
        }
    }

    // 3. Load from storage (covers project skills and previously registered)
    let all_stored = skill_queries::list_skills(conn)?;
    for stored in &all_stored {
        if !skills.iter().any(|s| s.id == stored.id) {
            skills.push(stored.clone());
        }
    }

    Ok(skills)
}

/// Resolve a skill by name, checking in priority order: project > user > system.
pub fn resolve(conn: &Connection, name: &str) -> AppResult<Option<Skill>> {
    let all_skills = skill_queries::list_skills(conn)?;
    let name_lower = name.to_lowercase();
    let scope_order = ["project", "user", "system"];

    for scope in &scope_order {
        let found = all_skills
            .iter()
            .find(|s| s.name.to_lowercase() == name_lower && s.scope == *scope);
        if let Some(skill) = found {
            return Ok(Some(skill.clone()));
        }
    }

    // Try partial match
    let partial = all_skills
        .iter()
        .find(|s| s.name.to_lowercase().contains(&name_lower));
    Ok(partial.cloned())
}

/// Get detailed information about a skill including its content.
pub fn get_detail(conn: &Connection, id: &str) -> AppResult<Option<SkillDetail>> {
    let all_skills = skill_queries::list_skills(conn)?;
    let skill = match all_skills.iter().find(|s| s.id == id) {
        Some(s) => s.clone(),
        None => return Ok(None),
    };

    let skill_file = Path::new(&skill.path).join("SKILL.md");
    let skill_file_str = skill_file.to_string_lossy().to_string();
    let parsed = match load_skill_file(&skill_file_str) {
        Some(p) => p,
        None => return Ok(None),
    };

    Ok(Some(SkillDetail {
        skill,
        content: parsed.raw_content,
        model: parsed.model,
        tools: parsed.tools,
        max_budget_usd: parsed.max_budget_usd,
    }))
}

/// Build an agent configuration from a skill.
pub fn invoke(skill: &Skill) -> AppResult<SkillConfig> {
    let skill_file = Path::new(&skill.path).join("SKILL.md");
    let skill_file_str = skill_file.to_string_lossy().to_string();
    let parsed = load_skill_file(&skill_file_str).ok_or_else(|| {
        AppError::NotFound(format!("Failed to load skill file for {}", skill.name))
    })?;

    Ok(SkillConfig {
        system_prompt: parsed.instructions,
        tools: parsed.tools.unwrap_or_default(),
        model: parsed.model,
        max_budget_usd: parsed.max_budget_usd,
    })
}

/// Create a new user skill.
pub fn create(conn: &Connection, definition: &SkillDefinition) -> AppResult<Skill> {
    let skills_base = get_skills_path();
    let dir_name = definition
        .name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_end_matches('-')
        .to_string();

    let skill_dir = skills_base.join(&dir_name);
    let skill_dir_str = skill_dir.to_string_lossy().to_string();

    let parsed = ParsedSkillDefinition {
        name: definition.name.clone(),
        description: definition.description.clone(),
        model: definition.model.clone(),
        tools: definition.tools.clone(),
        max_budget_usd: definition.max_budget_usd,
        instructions: definition.content.clone(),
        raw_content: String::new(),
    };

    write_skill_file(&skill_dir_str, &parsed);

    let id = uuid::Uuid::new_v4().to_string();
    let scope = &definition.scope;
    let skill = skill_queries::add_skill(
        conn,
        &id,
        &definition.name,
        &definition.description,
        scope,
        &skill_dir_str,
    )?;

    Ok(skill)
}

/// Update an existing skill.
pub fn update(conn: &Connection, id: &str, definition: &SkillDefinition) -> AppResult<Skill> {
    let all_skills = skill_queries::list_skills(conn)?;
    let existing = all_skills
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Skill not found: {}", id)))?;

    let parsed = ParsedSkillDefinition {
        name: definition.name.clone(),
        description: definition.description.clone(),
        model: definition.model.clone(),
        tools: definition.tools.clone(),
        max_budget_usd: definition.max_budget_usd,
        instructions: definition.content.clone(),
        raw_content: String::new(),
    };

    write_skill_file(&existing.path, &parsed);

    // Delete and re-add to update in storage
    skill_queries::delete_skill(conn, id)?;
    let skill = skill_queries::add_skill(
        conn,
        id,
        &definition.name,
        &definition.description,
        &existing.scope,
        &existing.path,
    )?;

    Ok(skill)
}

/// Delete a skill from the database.
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    skill_queries::delete_skill(conn, id)?;
    Ok(())
}

/// Import skills from a Git repository URL.
///
/// Clones the repo into the user skills directory and recursively finds
/// all SKILL.md files, registering them as user-scope skills.
pub async fn import_from_git(conn: &Connection, git_url: &str) -> AppResult<Vec<Skill>> {
    use tokio::process::Command;

    let skills_base = get_skills_path();
    tokio::fs::create_dir_all(&skills_base)
        .await
        .map_err(AppError::Io)?;

    // Extract repo name from URL
    let repo_name = git_url
        .trim_end_matches(".git")
        .rsplit('/')
        .next()
        .unwrap_or("skill-repo")
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>();

    let target_dir = skills_base.join(&repo_name);
    let target_dir_str = target_dir.to_string_lossy().to_string();

    if target_dir.exists() {
        // Pull latest changes
        info!(target: "skills-engine", "Directory {} exists, pulling latest changes", target_dir_str);
        let output = Command::new("git")
            .args(["pull"])
            .current_dir(&target_dir)
            .output()
            .await
            .map_err(AppError::Io)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(target: "skills-engine", "Git pull failed: {}", stderr);
        }
    } else {
        // Clone
        info!(target: "skills-engine", "Cloning {} to {}", git_url, target_dir_str);
        let output = Command::new("git")
            .args(["clone", git_url, &target_dir_str])
            .output()
            .await
            .map_err(AppError::Io)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Other(format!("Git clone failed: {}", stderr)));
        }
    }

    // Recursively find all SKILL.md files
    let skill_files = find_skill_files_recursive(&target_dir_str);
    info!(target: "skills-engine", "Found {} SKILL.md files", skill_files.len());

    let existing_skills = skill_queries::list_skills(conn)?;
    let mut imported = Vec::new();

    for skill_file_path in &skill_files {
        if let Some(parsed) = load_skill_file(skill_file_path) {
            let skill_dir = Path::new(skill_file_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let already_exists = existing_skills.iter().any(|s| s.path == skill_dir);

            if !already_exists {
                let id = uuid::Uuid::new_v4().to_string();
                let skill = skill_queries::add_skill(
                    conn,
                    &id,
                    &parsed.name,
                    &parsed.description,
                    "user",
                    &skill_dir,
                )?;
                imported.push(skill);
                info!(target: "skills-engine", "Imported skill: {}", parsed.name);
            } else {
                info!(target: "skills-engine", "Skill already exists: {}", parsed.name);
            }
        }
    }

    if imported.is_empty() && skill_files.is_empty() {
        return Err(AppError::NotFound(
            "No SKILL.md files found in repository.".into(),
        ));
    }

    if imported.is_empty() {
        return Err(AppError::Other(
            "All skills from this repository are already imported.".into(),
        ));
    }

    Ok(imported)
}

/// Recursively find all SKILL.md files in a directory.
fn find_skill_files_recursive(dir: &str) -> Vec<String> {
    let mut results = Vec::new();

    fn scan(current_dir: &Path, results: &mut Vec<String>) {
        let entries = match std::fs::read_dir(current_dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden directories and common non-skill directories
                if name.starts_with('.')
                    || name == "node_modules"
                    || name == "__pycache__"
                    || name == "target"
                {
                    continue;
                }
                scan(&path, results);
            } else if path.is_file() {
                if entry.file_name() == "SKILL.md" {
                    results.push(path.to_string_lossy().to_string());
                }
            }
        }
    }

    scan(Path::new(dir), &mut results);
    results
}
