use serde::{Deserialize, Serialize};

use crate::db::models::AppSettings;
use crate::db::queries::settings as settings_queries;
use crate::state::AppState;

// ── Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────

/// Get all application settings.
#[tauri::command]
pub fn settings_get(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let db = state.db.lock();
    settings_queries::get_app_settings(&db).map_err(|e| e.to_string())
}

/// Update application settings (merge-update).
#[tauri::command]
pub fn settings_update(
    state: tauri::State<'_, AppState>,
    settings: serde_json::Value,
) -> Result<(), String> {
    let db = state.db.lock();
    settings_queries::update_app_settings(&db, &settings).map_err(|e| e.to_string())?;

    // If max_concurrent_agents changed, update the orchestrator
    if let Some(max) = settings.get("maxConcurrentAgents").and_then(|v| v.as_u64()) {
        crate::services::agent_orchestrator::set_max_concurrent(&state, max as usize);
    }

    Ok(())
}

/// Detect the Claude CLI installation status.
#[tauri::command]
pub fn settings_get_cli_status(state: tauri::State<'_, AppState>) -> Result<CliStatus, String> {
    // Check for a custom path in settings first
    let custom_path = {
        let db = state.db.lock();
        settings_queries::get_app_settings(&db)
            .ok()
            .and_then(|s| s.claude_cli_path)
    };

    // Try the custom path, then fall back to "claude" on PATH
    let candidates = match custom_path {
        Some(ref p) => vec![p.as_str(), "claude"],
        None => vec!["claude"],
    };

    for candidate in &candidates {
        match std::process::Command::new(candidate)
            .args(["--version"])
            .output()
        {
            Ok(output) if output.status.success() => {
                let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Ok(CliStatus {
                    available: true,
                    version: if version_str.is_empty() {
                        None
                    } else {
                        Some(version_str)
                    },
                    path: Some(candidate.to_string()),
                });
            }
            _ => continue,
        }
    }

    Ok(CliStatus {
        available: false,
        version: None,
        path: None,
    })
}
