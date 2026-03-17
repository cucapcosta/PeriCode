use serde::{Deserialize, Serialize};

use crate::db::models::{ModelInfo, ProviderInfo, ProviderType};
use crate::db::queries::settings as settings_queries;
use crate::providers::copilot_auth;
use crate::providers::types::{claude_models, copilot_models};
use crate::state::AppState;

// ── Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotStartAuthResult {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotPollAuthResult {
    pub success: bool,
    pub username: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotCheckAuthResult {
    pub authenticated: bool,
    pub username: Option<String>,
}

// ── Commands ──────────────────────────────────────────────────

/// List all available providers and their status.
#[tauri::command]
pub fn provider_list(state: tauri::State<'_, AppState>) -> Result<Vec<ProviderInfo>, String> {
    let db = state.db.lock();
    let app_settings = settings_queries::get_app_settings(&db).map_err(|e| e.to_string())?;
    drop(db);

    let providers_settings = app_settings.providers;

    // Claude is available if the CLI is on PATH (or configured)
    let claude_available = std::process::Command::new("claude")
        .args(["--version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    // Copilot is available if authenticated
    let copilot_available = providers_settings
        .as_ref()
        .map(|p| p.copilot.authenticated)
        .unwrap_or(false);

    Ok(vec![
        ProviderInfo {
            id: ProviderType::Claude,
            name: "Claude (Anthropic)".to_string(),
            available: claude_available,
        },
        ProviderInfo {
            id: ProviderType::Copilot,
            name: "GitHub Copilot".to_string(),
            available: copilot_available,
        },
    ])
}

/// Get available models for a specific provider.
#[tauri::command]
pub fn provider_get_models(
    _state: tauri::State<'_, AppState>,
    provider: ProviderType,
) -> Result<Vec<ModelInfo>, String> {
    match provider {
        ProviderType::Claude => Ok(claude_models()),
        ProviderType::Copilot => Ok(copilot_models()),
    }
}

/// Start the GitHub Copilot device authentication flow.
#[tauri::command]
pub async fn copilot_start_auth() -> Result<CopilotStartAuthResult, String> {
    let device_code_response = copilot_auth::initiate_device_flow()
        .await
        .map_err(|e| e.to_string())?;

    Ok(CopilotStartAuthResult {
        user_code: device_code_response.user_code,
        verification_uri: device_code_response.verification_uri,
        device_code: device_code_response.device_code,
        expires_in: device_code_response.expires_in,
        interval: device_code_response.interval,
    })
}

/// Poll for the Copilot device auth token after the user has authorized.
#[tauri::command]
pub async fn copilot_poll_auth(
    state: tauri::State<'_, AppState>,
    device_code: String,
    interval: u64,
    expires_in: u64,
) -> Result<CopilotPollAuthResult, String> {
    match copilot_auth::poll_for_token(&device_code, interval, expires_in).await {
        Ok(access_token) => {
            // Get user info
            let username = match copilot_auth::get_github_user(&access_token).await {
                Ok(user) => user.login,
                Err(_) => "unknown".to_string(),
            };

            // Save tokens
            let db = state.db.lock();
            copilot_auth::save_tokens(&db, &access_token, &username);
            drop(db);

            Ok(CopilotPollAuthResult {
                success: true,
                username: Some(username),
                error: None,
            })
        }
        Err(e) => Ok(CopilotPollAuthResult {
            success: false,
            username: None,
            error: Some(e.to_string()),
        }),
    }
}

/// Check if the user is currently authenticated with Copilot.
#[tauri::command]
pub fn copilot_check_auth(
    state: tauri::State<'_, AppState>,
) -> Result<CopilotCheckAuthResult, String> {
    let db = state.db.lock();
    let authenticated = copilot_auth::is_authenticated(&db);

    let username = if authenticated {
        settings_queries::get_app_settings(&db)
            .ok()
            .and_then(|s| s.providers)
            .and_then(|p| p.copilot.username)
    } else {
        None
    };

    Ok(CopilotCheckAuthResult {
        authenticated,
        username,
    })
}

/// Log out of Copilot (clear stored tokens).
#[tauri::command]
pub fn copilot_logout(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock();
    copilot_auth::clear_tokens(&db);
    Ok(())
}
