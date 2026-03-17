use anyhow::Result;
use chrono::Utc;
use rusqlite::Connection;

/// Get the note content for a thread, if any.
pub fn get_thread_note(conn: &Connection, thread_id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT content FROM thread_notes WHERE thread_id = ?1")?;
    let mut rows = stmt.query_map(rusqlite::params![thread_id], |row| {
        let content: String = row.get(0)?;
        Ok(content)
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Save (upsert) a thread note.
pub fn save_thread_note(conn: &Connection, thread_id: &str, content: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO thread_notes (thread_id, content, updated_at) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(thread_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
        rusqlite::params![thread_id, content, &now],
    )?;
    Ok(())
}

/// Delete a thread note.
pub fn delete_thread_note(conn: &Connection, thread_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM thread_notes WHERE thread_id = ?1",
        rusqlite::params![thread_id],
    )?;
    Ok(())
}
