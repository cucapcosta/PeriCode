use anyhow::Result;
use chrono::Utc;
use rusqlite::Connection;

use crate::db::models::Skill;

/// List all skills ordered by name ascending.
pub fn list_skills(conn: &Connection) -> Result<Vec<Skill>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, scope, path, created_at, updated_at FROM skills ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Skill {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            scope: row.get(3)?,
            path: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    let mut skills = Vec::new();
    for row in rows {
        skills.push(row?);
    }
    Ok(skills)
}

/// Add a new skill.
pub fn add_skill(
    conn: &Connection,
    id: &str,
    name: &str,
    description: &str,
    scope: &str,
    path: &str,
) -> Result<Skill> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO skills (id, name, description, scope, path, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, name, description, scope, path, &now, &now],
    )?;
    Ok(Skill {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        scope: scope.to_string(),
        path: path.to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Delete a skill by id.
pub fn delete_skill(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM skills WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}
