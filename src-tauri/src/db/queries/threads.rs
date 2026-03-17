use anyhow::Result;
use chrono::Utc;
use rusqlite::Connection;

use crate::db::models::ThreadInfo;

/// Map a rusqlite row to ThreadInfo.
fn map_thread(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThreadInfo> {
    Ok(ThreadInfo {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        status: row.get("status")?,
        session_id: row.get("session_id")?,
        worktree_path: row.get("worktree_path")?,
        worktree_branch: row.get("worktree_branch")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// List all threads for a project, ordered by updated_at descending.
pub fn list_threads(conn: &Connection, project_id: &str) -> Result<Vec<ThreadInfo>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, status, session_id, worktree_path, worktree_branch, provider, model, created_at, updated_at \
         FROM threads WHERE project_id = ?1 ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![project_id], |row| map_thread(row))?;
    let mut threads = Vec::new();
    for row in rows {
        threads.push(row?);
    }
    Ok(threads)
}

/// Create a new thread.
pub fn create_thread(
    conn: &Connection,
    id: &str,
    project_id: &str,
    title: Option<&str>,
    session_id: Option<&str>,
    worktree_path: Option<&str>,
    worktree_branch: Option<&str>,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<ThreadInfo> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO threads (id, project_id, title, status, session_id, worktree_path, worktree_branch, provider, model, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            project_id,
            title,
            session_id,
            worktree_path,
            worktree_branch,
            provider,
            model,
            &now,
            &now
        ],
    )?;
    Ok(ThreadInfo {
        id: id.to_string(),
        project_id: project_id.to_string(),
        title: title.map(|s| s.to_string()),
        status: "running".to_string(),
        session_id: session_id.map(|s| s.to_string()),
        worktree_path: worktree_path.map(|s| s.to_string()),
        worktree_branch: worktree_branch.map(|s| s.to_string()),
        provider: provider.map(|s| s.to_string()),
        model: model.map(|s| s.to_string()),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Get a single thread by id.
pub fn get_thread(conn: &Connection, id: &str) -> Result<Option<ThreadInfo>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, status, session_id, worktree_path, worktree_branch, provider, model, created_at, updated_at \
         FROM threads WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], |row| map_thread(row))?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Update a thread's status.
pub fn update_thread_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE threads SET status = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![status, &now, id],
    )?;
    Ok(())
}

/// Update a thread's session id.
pub fn update_thread_session(conn: &Connection, id: &str, session_id: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE threads SET session_id = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![session_id, &now, id],
    )?;
    Ok(())
}

/// Update a thread's worktree path and branch.
pub fn update_thread_worktree(
    conn: &Connection,
    id: &str,
    worktree_path: Option<&str>,
    worktree_branch: Option<&str>,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE threads SET worktree_path = ?1, worktree_branch = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![worktree_path, worktree_branch, &now, id],
    )?;
    Ok(())
}

/// Update a thread's provider and model.
pub fn update_thread_provider(
    conn: &Connection,
    id: &str,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE threads SET provider = ?1, model = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![provider, model, &now, id],
    )?;
    Ok(())
}

/// Mark all currently running threads as failed (used on startup to clean stale state).
pub fn mark_stale_running_threads(conn: &Connection) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE threads SET status = 'failed', updated_at = ?1 WHERE status = 'running'",
        rusqlite::params![&now],
    )?;
    Ok(())
}

/// Delete a thread and all related data (notes, model_usage, messages).
pub fn delete_thread(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM thread_notes WHERE thread_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM model_usage WHERE thread_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM messages WHERE thread_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute("DELETE FROM threads WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}
