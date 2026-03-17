use anyhow::Result;
use rusqlite::Connection;

use crate::db::models::AppSettings;

/// Get a single setting by key, returned as a serde_json::Value.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<serde_json::Value>> {
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(rusqlite::params![key], |row| {
        let value_str: String = row.get(0)?;
        Ok(value_str)
    })?;
    match rows.next() {
        Some(row) => {
            let value_str = row?;
            let value: serde_json::Value = serde_json::from_str(&value_str)?;
            Ok(Some(value))
        }
        None => Ok(None),
    }
}

/// Set a setting by key (INSERT OR REPLACE).
pub fn set_setting(conn: &Connection, key: &str, value: &serde_json::Value) -> Result<()> {
    let value_str = serde_json::to_string(value)?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value_str],
    )?;
    Ok(())
}

/// Get the full app settings, with defaults matching the TypeScript version.
pub fn get_app_settings(conn: &Connection) -> Result<AppSettings> {
    let saved = get_setting(conn, "app_settings")?;
    let defaults = AppSettings::default();

    match saved {
        Some(saved_val) => {
            // Start from defaults, overlay saved values
            let mut defaults_val = serde_json::to_value(&defaults)?;
            if let (Some(base), Some(overlay)) =
                (defaults_val.as_object_mut(), saved_val.as_object())
            {
                for (k, v) in overlay {
                    base.insert(k.clone(), v.clone());
                }
            }
            let settings: AppSettings = serde_json::from_value(defaults_val)?;
            Ok(settings)
        }
        None => Ok(defaults),
    }
}

/// Merge-update app settings (existing keys preserved, new keys added/overwritten).
pub fn update_app_settings(conn: &Connection, settings: &serde_json::Value) -> Result<()> {
    let current = get_app_settings(conn)?;
    let mut current_val = serde_json::to_value(&current)?;
    if let (Some(base), Some(overlay)) = (current_val.as_object_mut(), settings.as_object()) {
        for (k, v) in overlay {
            base.insert(k.clone(), v.clone());
        }
    }
    set_setting(conn, "app_settings", &current_val)?;
    Ok(())
}
