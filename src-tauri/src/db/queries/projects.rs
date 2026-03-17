use anyhow::Result;
use chrono::Utc;
use rusqlite::Connection;

use crate::db::models::{Project, ProjectSettings};

/// List all projects ordered by last_opened_at descending.
pub fn list_projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, created_at, last_opened_at, settings FROM projects ORDER BY last_opened_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let settings_json: String = row.get(5)?;
        let settings: ProjectSettings =
            serde_json::from_str(&settings_json).unwrap_or_default();
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            created_at: row.get(3)?,
            last_opened_at: row.get(4)?,
            settings,
        })
    })?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(row?);
    }
    Ok(projects)
}

/// Add a new project.
pub fn add_project(conn: &Connection, id: &str, name: &str, path: &str) -> Result<Project> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at, settings) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, name, path, &now, &now, "{}"],
    )?;
    Ok(Project {
        id: id.to_string(),
        name: name.to_string(),
        path: path.to_string(),
        created_at: now.clone(),
        last_opened_at: Some(now),
        settings: ProjectSettings::default(),
    })
}

/// Remove a project and cascade-delete all related data.
pub fn remove_project(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM thread_notes WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?1)",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM model_usage WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?1)",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?1)",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM threads WHERE project_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM automation_runs WHERE automation_id IN (SELECT id FROM automations WHERE project_id = ?1)",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM automations WHERE project_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

/// Get a single project by id.
pub fn get_project(conn: &Connection, id: &str) -> Result<Option<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, created_at, last_opened_at, settings FROM projects WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], |row| {
        let settings_json: String = row.get(5)?;
        let settings: ProjectSettings =
            serde_json::from_str(&settings_json).unwrap_or_default();
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            created_at: row.get(3)?,
            last_opened_at: row.get(4)?,
            settings,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Merge-update a project's settings (existing keys preserved, new keys added/overwritten).
pub fn update_project_settings(
    conn: &Connection,
    id: &str,
    settings: &ProjectSettings,
) -> Result<()> {
    let project = get_project(conn, id)?
        .ok_or_else(|| anyhow::anyhow!("Project not found: {}", id))?;

    // Merge: start with existing settings, overlay the new ones
    let existing_val = serde_json::to_value(&project.settings)?;
    let new_val = serde_json::to_value(settings)?;
    let mut merged = existing_val
        .as_object()
        .cloned()
        .unwrap_or_default();
    if let Some(obj) = new_val.as_object() {
        for (k, v) in obj {
            merged.insert(k.clone(), v.clone());
        }
    }
    let merged_json = serde_json::to_string(&merged)?;
    conn.execute(
        "UPDATE projects SET settings = ?1 WHERE id = ?2",
        rusqlite::params![merged_json, id],
    )?;
    Ok(())
}

/// Touch a project (update last_opened_at to now).
pub fn touch_project(conn: &Connection, id: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE projects SET last_opened_at = ?1 WHERE id = ?2",
        rusqlite::params![&now, id],
    )?;
    Ok(())
}
