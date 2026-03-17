pub mod models;
pub mod queries;
pub mod schema;

use anyhow::Result;
use rusqlite::Connection;
use tracing::info;

use schema::SCHEMA;

/// Initialize the SQLite database: create tables, run migrations.
pub fn initialize(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(SCHEMA)?;

    info!("Database schema applied at {}", db_path);

    // Migration: add model_id column to messages if not present
    if conn
        .execute_batch("ALTER TABLE messages ADD COLUMN model_id TEXT")
        .is_ok()
    {
        info!("Migration: added model_id column to messages");
    }

    // Migration: add provider column to threads if not present
    if conn
        .execute_batch("ALTER TABLE threads ADD COLUMN provider TEXT")
        .is_ok()
    {
        info!("Migration: added provider column to threads");
    }

    // Migration: add model column to threads if not present
    if conn
        .execute_batch("ALTER TABLE threads ADD COLUMN model TEXT")
        .is_ok()
    {
        info!("Migration: added model column to threads");
    }

    Ok(conn)
}
