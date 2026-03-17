use anyhow::Result;
use rusqlite::Connection;

use crate::db::models::{Automation, AutomationRun, InboxFilters};

/// Map a rusqlite row to Automation.
fn map_automation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Automation> {
    let skill_ids_json: String = row.get("skill_ids")?;
    let skill_ids: Vec<String> = serde_json::from_str(&skill_ids_json).unwrap_or_default();
    let trigger_config_json: String = row.get("trigger_config")?;
    let trigger_config: serde_json::Value =
        serde_json::from_str(&trigger_config_json).unwrap_or(serde_json::json!({}));
    let enabled_int: i32 = row.get("enabled")?;
    Ok(Automation {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        prompt: row.get("prompt")?,
        skill_ids,
        schedule: row.get("schedule")?,
        trigger_type: row.get("trigger_type")?,
        trigger_config,
        enabled: enabled_int == 1,
        last_run_at: row.get("last_run_at")?,
        created_at: row.get("created_at")?,
    })
}

/// Map a rusqlite row to AutomationRun.
fn map_automation_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRun> {
    let result_json: Option<String> = row.get("result")?;
    let result = result_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok());
    let read_int: i32 = row.get("read")?;
    Ok(AutomationRun {
        id: row.get("id")?,
        automation_id: row.get("automation_id")?,
        status: row.get("status")?,
        result,
        read: read_int == 1,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
    })
}

/// List all automations for a project, ordered by created_at descending.
pub fn list_automations(conn: &Connection, project_id: &str) -> Result<Vec<Automation>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, name, prompt, skill_ids, schedule, trigger_type, trigger_config, enabled, last_run_at, created_at \
         FROM automations WHERE project_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![project_id], |row| map_automation(row))?;
    let mut automations = Vec::new();
    for row in rows {
        automations.push(row?);
    }
    Ok(automations)
}

/// Get a single automation by id.
pub fn get_automation(conn: &Connection, id: &str) -> Result<Option<Automation>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, name, prompt, skill_ids, schedule, trigger_type, trigger_config, enabled, last_run_at, created_at \
         FROM automations WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], |row| map_automation(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Add a new automation.
pub fn add_automation(
    conn: &Connection,
    id: &str,
    project_id: &str,
    name: &str,
    prompt: &str,
    trigger_type: &str,
    trigger_config: &serde_json::Value,
    skill_ids: &[String],
    schedule: Option<&str>,
    enabled: bool,
) -> Result<Automation> {
    let skill_ids_json = serde_json::to_string(skill_ids)?;
    let trigger_config_json = serde_json::to_string(trigger_config)?;
    conn.execute(
        "INSERT INTO automations (id, project_id, name, prompt, skill_ids, schedule, trigger_type, trigger_config, enabled) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            id,
            project_id,
            name,
            prompt,
            skill_ids_json,
            schedule,
            trigger_type,
            trigger_config_json,
            if enabled { 1 } else { 0 }
        ],
    )?;
    get_automation(conn, id)?
        .ok_or_else(|| anyhow::anyhow!("Failed to retrieve automation after insert"))
}

/// Update an automation with dynamic fields.
pub fn update_automation(
    conn: &Connection,
    id: &str,
    updates: &serde_json::Value,
) -> Result<Automation> {
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(name) = updates.get("name").and_then(|v| v.as_str()) {
        sets.push("name = ?".to_string());
        params.push(Box::new(name.to_string()));
    }
    if let Some(prompt) = updates.get("prompt").and_then(|v| v.as_str()) {
        sets.push("prompt = ?".to_string());
        params.push(Box::new(prompt.to_string()));
    }
    if let Some(skill_ids) = updates.get("skillIds") {
        sets.push("skill_ids = ?".to_string());
        params.push(Box::new(serde_json::to_string(skill_ids)?));
    }
    if updates.get("schedule").is_some() {
        sets.push("schedule = ?".to_string());
        let schedule = updates["schedule"].as_str().map(|s| s.to_string());
        params.push(Box::new(schedule));
    }
    if let Some(trigger_type) = updates.get("triggerType").and_then(|v| v.as_str()) {
        sets.push("trigger_type = ?".to_string());
        params.push(Box::new(trigger_type.to_string()));
    }
    if let Some(trigger_config) = updates.get("triggerConfig") {
        sets.push("trigger_config = ?".to_string());
        params.push(Box::new(serde_json::to_string(trigger_config)?));
    }
    if let Some(enabled) = updates.get("enabled").and_then(|v| v.as_bool()) {
        sets.push("enabled = ?".to_string());
        params.push(Box::new(if enabled { 1i32 } else { 0i32 }));
    }
    if let Some(last_run_at) = updates.get("lastRunAt").and_then(|v| v.as_str()) {
        sets.push("last_run_at = ?".to_string());
        params.push(Box::new(last_run_at.to_string()));
    }

    if !sets.is_empty() {
        params.push(Box::new(id.to_string()));
        let sql = format!("UPDATE automations SET {} WHERE id = ?", sets.join(", "));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    get_automation(conn, id)?
        .ok_or_else(|| anyhow::anyhow!("Automation not found: {}", id))
}

/// Delete an automation and its runs.
pub fn delete_automation(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM automation_runs WHERE automation_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM automations WHERE id = ?1",
        rusqlite::params![id],
    )?;
    Ok(())
}

// ── Automation Runs ───────────────────────────────────────────

/// List all runs for an automation, ordered by started_at descending.
pub fn list_automation_runs(
    conn: &Connection,
    automation_id: &str,
) -> Result<Vec<AutomationRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, automation_id, status, result, read, started_at, finished_at \
         FROM automation_runs WHERE automation_id = ?1 ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![automation_id], |row| {
        map_automation_run(row)
    })?;
    let mut runs = Vec::new();
    for row in rows {
        runs.push(row?);
    }
    Ok(runs)
}

/// Add a new automation run with status 'running'.
pub fn add_automation_run(
    conn: &Connection,
    id: &str,
    automation_id: &str,
) -> Result<AutomationRun> {
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, status) VALUES (?1, ?2, 'running')",
        rusqlite::params![id, automation_id],
    )?;
    get_automation_run(conn, id)?
        .ok_or_else(|| anyhow::anyhow!("Failed to retrieve automation run after insert"))
}

/// Get a single automation run by id.
pub fn get_automation_run(conn: &Connection, id: &str) -> Result<Option<AutomationRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, automation_id, status, result, read, started_at, finished_at \
         FROM automation_runs WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], |row| map_automation_run(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Update an automation run with dynamic fields.
pub fn update_automation_run(
    conn: &Connection,
    id: &str,
    updates: &serde_json::Value,
) -> Result<AutomationRun> {
    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(status) = updates.get("status").and_then(|v| v.as_str()) {
        sets.push("status = ?".to_string());
        params.push(Box::new(status.to_string()));
    }
    if let Some(result) = updates.get("result") {
        sets.push("result = ?".to_string());
        params.push(Box::new(serde_json::to_string(result)?));
    }
    if let Some(read) = updates.get("read").and_then(|v| v.as_bool()) {
        sets.push("read = ?".to_string());
        params.push(Box::new(if read { 1i32 } else { 0i32 }));
    }
    if let Some(finished_at) = updates.get("finishedAt").and_then(|v| v.as_str()) {
        sets.push("finished_at = ?".to_string());
        params.push(Box::new(finished_at.to_string()));
    }

    if !sets.is_empty() {
        params.push(Box::new(id.to_string()));
        let sql = format!(
            "UPDATE automation_runs SET {} WHERE id = ?",
            sets.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    get_automation_run(conn, id)?
        .ok_or_else(|| anyhow::anyhow!("Automation run not found: {}", id))
}

/// List inbox runs with optional filters (joins automations for project_id filter).
pub fn list_inbox_runs(conn: &Connection, filters: &InboxFilters) -> Result<Vec<AutomationRun>> {
    let mut sql = String::from(
        "SELECT ar.id, ar.automation_id, ar.status, ar.result, ar.read, ar.started_at, ar.finished_at \
         FROM automation_runs ar JOIN automations a ON ar.automation_id = a.id WHERE 1=1",
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref automation_id) = filters.automation_id {
        sql.push_str(" AND ar.automation_id = ?");
        params.push(Box::new(automation_id.clone()));
    }
    if let Some(ref status) = filters.status {
        sql.push_str(" AND ar.status = ?");
        params.push(Box::new(status.clone()));
    }
    if let Some(ref project_id) = filters.project_id {
        sql.push_str(" AND a.project_id = ?");
        params.push(Box::new(project_id.clone()));
    }
    if filters.unread_only == Some(true) {
        sql.push_str(" AND ar.read = 0");
    }
    sql.push_str(" ORDER BY ar.started_at DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| map_automation_run(row))?;
    let mut runs = Vec::new();
    for row in rows {
        runs.push(row?);
    }
    Ok(runs)
}
