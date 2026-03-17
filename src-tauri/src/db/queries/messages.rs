use anyhow::Result;
use chrono::Utc;
use rusqlite::Connection;

use crate::db::models::{Message, MessageContent};

/// List all messages for a thread, ordered by created_at ascending.
pub fn list_messages(conn: &Connection, thread_id: &str) -> Result<Vec<Message>> {
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, content, cost_usd, tokens_in, tokens_out, model_id, created_at \
         FROM messages WHERE thread_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![thread_id], |row| {
        let content_json: String = row.get(3)?;
        let content: Vec<MessageContent> =
            serde_json::from_str(&content_json).unwrap_or_default();
        Ok(Message {
            id: row.get(0)?,
            thread_id: row.get(1)?,
            role: row.get(2)?,
            content,
            cost_usd: row.get(4)?,
            tokens_in: row.get(5)?,
            tokens_out: row.get(6)?,
            model_id: row.get(7)?,
            created_at: row.get(8)?,
            image_paths: None,
        })
    })?;
    let mut messages = Vec::new();
    for row in rows {
        messages.push(row?);
    }
    Ok(messages)
}

/// Add a message to a thread. Also bumps the thread's updated_at.
pub fn add_message(
    conn: &Connection,
    id: &str,
    thread_id: &str,
    role: &str,
    content: &[MessageContent],
    cost_usd: Option<f64>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
    model_id: Option<&str>,
) -> Result<Message> {
    let now = Utc::now().to_rfc3339();
    let content_json = serde_json::to_string(content)?;
    conn.execute(
        "INSERT INTO messages (id, thread_id, role, content, cost_usd, tokens_in, tokens_out, model_id, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![id, thread_id, role, content_json, cost_usd, tokens_in, tokens_out, model_id, &now],
    )?;
    conn.execute(
        "UPDATE threads SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![&now, thread_id],
    )?;
    Ok(Message {
        id: id.to_string(),
        thread_id: thread_id.to_string(),
        role: role.to_string(),
        content: content.to_vec(),
        cost_usd,
        tokens_in,
        tokens_out,
        model_id: model_id.map(|s| s.to_string()),
        created_at: now,
        image_paths: None,
    })
}
