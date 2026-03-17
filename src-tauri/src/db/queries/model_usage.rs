use anyhow::Result;
use rusqlite::Connection;
use std::collections::HashMap;

use crate::db::models::ModelTokenUsage;

/// Add model usage entries for a thread. One row per model in the map.
pub fn add_model_usage(
    conn: &Connection,
    thread_id: &str,
    model_usage: &HashMap<String, ModelTokenUsage>,
) -> Result<()> {
    let mut stmt = conn.prepare(
        "INSERT INTO model_usage (thread_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for (model, usage) in model_usage {
        stmt.execute(rusqlite::params![
            thread_id,
            model,
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_input_tokens,
            usage.cache_creation_input_tokens,
            usage.cost_usd,
        ])?;
    }
    Ok(())
}

/// Get aggregated model usage for a single thread, grouped by model.
pub fn get_thread_model_usage(
    conn: &Connection,
    thread_id: &str,
) -> Result<HashMap<String, ModelTokenUsage>> {
    let mut stmt = conn.prepare(
        "SELECT model, \
                SUM(input_tokens) as input_tokens, \
                SUM(output_tokens) as output_tokens, \
                SUM(cache_read_tokens) as cache_read_tokens, \
                SUM(cache_creation_tokens) as cache_creation_tokens, \
                SUM(cost_usd) as cost_usd \
         FROM model_usage WHERE thread_id = ?1 GROUP BY model",
    )?;
    let rows = stmt.query_map(rusqlite::params![thread_id], |row| {
        let model: String = row.get(0)?;
        let usage = ModelTokenUsage {
            input_tokens: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
            output_tokens: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
            cache_read_input_tokens: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            cache_creation_input_tokens: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
            cost_usd: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
        };
        Ok((model, usage))
    })?;
    let mut result = HashMap::new();
    for row in rows {
        let (model, usage) = row?;
        result.insert(model, usage);
    }
    Ok(result)
}

/// Get total cost per project (project_id -> total cost from messages table).
pub fn get_all_project_costs(conn: &Connection) -> Result<HashMap<String, f64>> {
    let mut stmt = conn.prepare(
        "SELECT t.project_id, SUM(m.cost_usd) as total_cost \
         FROM messages m JOIN threads t ON m.thread_id = t.id \
         WHERE m.cost_usd IS NOT NULL \
         GROUP BY t.project_id",
    )?;
    let rows = stmt.query_map([], |row| {
        let project_id: String = row.get(0)?;
        let total_cost: f64 = row.get::<_, Option<f64>>(1)?.unwrap_or(0.0);
        Ok((project_id, total_cost))
    })?;
    let mut costs = HashMap::new();
    for row in rows {
        let (project_id, total_cost) = row?;
        costs.insert(project_id, total_cost);
    }
    Ok(costs)
}

/// Get global (all threads) model usage aggregated by model.
pub fn get_global_model_usage(conn: &Connection) -> Result<HashMap<String, ModelTokenUsage>> {
    let mut stmt = conn.prepare(
        "SELECT model, \
                SUM(input_tokens) as input_tokens, \
                SUM(output_tokens) as output_tokens, \
                SUM(cache_read_tokens) as cache_read_tokens, \
                SUM(cache_creation_tokens) as cache_creation_tokens, \
                SUM(cost_usd) as cost_usd \
         FROM model_usage GROUP BY model",
    )?;
    let rows = stmt.query_map([], |row| {
        let model: String = row.get(0)?;
        let usage = ModelTokenUsage {
            input_tokens: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
            output_tokens: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
            cache_read_input_tokens: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            cache_creation_input_tokens: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
            cost_usd: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
        };
        Ok((model, usage))
    })?;
    let mut result = HashMap::new();
    for row in rows {
        let (model, usage) = row?;
        result.insert(model, usage);
    }
    Ok(result)
}
