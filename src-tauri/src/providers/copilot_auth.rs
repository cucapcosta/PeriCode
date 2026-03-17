use anyhow::{bail, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tracing::{info, error};

use crate::db::models::{ClaudeProviderSettings, CopilotProviderSettings, ProvidersSettings, ProviderType};
use crate::db::queries::settings;

// ── Constants ────────────────────────────────────────────────

/// GitHub Copilot client ID (public, from VS Code Copilot extension).
pub const COPILOT_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";

pub const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
pub const GITHUB_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
pub const GITHUB_USER_URL: &str = "https://api.github.com/user";
pub const COPILOT_TOKEN_URL: &str = "https://api.github.com/copilot_internal/v2/token";

// ── Types ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopilotToken {
    pub token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

// ── Device Flow Implementation ───────────────────────────────

/// Step 1: Request device code from GitHub.
pub async fn initiate_device_flow() -> Result<DeviceCodeResponse> {
    info!("copilot-auth: initiating device flow");

    let client = reqwest::Client::new();
    let response = client
        .post(GITHUB_DEVICE_CODE_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": COPILOT_CLIENT_ID,
            "scope": "read:user",
        }))
        .send()
        .await?;

    if !response.status().is_success() {
        bail!("Device code request failed: {}", response.status());
    }

    let data: DeviceCodeResponse = response.json().await?;
    info!("copilot-auth: device code received, user code: {}", data.user_code);

    Ok(data)
}

/// Step 2: Poll for token after user authorizes.
pub async fn poll_for_token(
    device_code: &str,
    mut interval: u64,
    expires_in: u64,
) -> Result<String> {
    let start = std::time::Instant::now();
    let expiry = std::time::Duration::from_secs(expires_in);

    info!("copilot-auth: polling for token...");

    let client = reqwest::Client::new();

    while start.elapsed() < expiry {
        tokio::time::sleep(std::time::Duration::from_secs(interval)).await;

        let response = client
            .post(GITHUB_TOKEN_URL)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&serde_json::json!({
                "client_id": COPILOT_CLIENT_ID,
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            }))
            .send()
            .await?;

        let data: TokenResponse = response.json().await?;

        if let Some(access_token) = data.access_token {
            if !access_token.is_empty() {
                info!("copilot-auth: token received successfully");
                return Ok(access_token);
            }
        }

        match data.error.as_deref() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval += 5;
                continue;
            }
            Some("expired_token") => bail!("Device code expired. Please try again."),
            Some("access_denied") => bail!("Authorization was denied by user."),
            Some(err) => {
                let desc = data.error_description.unwrap_or_default();
                bail!("{}", if desc.is_empty() { err.to_string() } else { desc });
            }
            None => continue,
        }
    }

    bail!("Polling timed out. Please try again.")
}

/// Get GitHub user info from access token.
pub async fn get_github_user(access_token: &str) -> Result<GitHubUser> {
    let client = reqwest::Client::new();
    let response = client
        .get(GITHUB_USER_URL)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Accept", "application/json")
        .send()
        .await?;

    if !response.status().is_success() {
        bail!("Failed to get user info: {}", response.status());
    }

    let user: GitHubUser = response.json().await?;
    Ok(user)
}

/// Get Copilot API token from GitHub access token.
pub async fn get_copilot_token(access_token: &str) -> Result<CopilotToken> {
    let client = reqwest::Client::new();
    let response = client
        .get(COPILOT_TOKEN_URL)
        .header("Authorization", format!("token {}", access_token))
        .header("Accept", "application/json")
        .header("Editor-Version", "vscode/1.85.0")
        .header("Editor-Plugin-Version", "copilot/1.0.0")
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        error!("copilot-auth: copilot token request failed: {} - {}", status, text);
        bail!("Failed to get Copilot token: {}", status);
    }

    let token: CopilotToken = response.json().await?;
    Ok(token)
}

// ── Token Storage ────────────────────────────────────────────

/// Save tokens to the app settings (SQLite).
pub fn save_tokens(conn: &Connection, access_token: &str, username: &str) {
    let current_settings = settings::get_app_settings(conn).unwrap_or_default();

    let providers = current_settings.providers.unwrap_or_else(|| ProvidersSettings {
        default_provider: ProviderType::Claude,
        claude: ClaudeProviderSettings {
            enabled: true,
            cli_path: None,
            default_model: "sonnet".to_string(),
        },
        copilot: CopilotProviderSettings {
            enabled: false,
            authenticated: false,
            access_token: None,
            refresh_token: None,
            token_expiry: None,
            default_model: "gpt-4.1".to_string(),
            username: None,
        },
    });

    let updated_providers = ProvidersSettings {
        default_provider: providers.default_provider,
        claude: providers.claude,
        copilot: CopilotProviderSettings {
            enabled: true,
            authenticated: true,
            access_token: Some(access_token.to_string()),
            refresh_token: None,
            token_expiry: None,
            default_model: providers.copilot.default_model,
            username: Some(username.to_string()),
        },
    };

    let update = serde_json::json!({
        "providers": serde_json::to_value(&updated_providers).unwrap_or_default(),
    });

    if let Err(e) = settings::update_app_settings(conn, &update) {
        error!("copilot-auth: failed to save tokens: {}", e);
    } else {
        info!("copilot-auth: tokens saved for user: {}", username);
    }
}

/// Get stored access token from app settings.
pub fn get_stored_token(conn: &Connection) -> Option<String> {
    let app_settings = settings::get_app_settings(conn).ok()?;
    app_settings.providers?.copilot.access_token
}

/// Check if the user is authenticated with Copilot.
pub fn is_authenticated(conn: &Connection) -> bool {
    let app_settings = match settings::get_app_settings(conn) {
        Ok(s) => s,
        Err(_) => return false,
    };
    match app_settings.providers {
        Some(p) => p.copilot.authenticated && p.copilot.access_token.is_some(),
        None => false,
    }
}

/// Clear all stored tokens (logout).
pub fn clear_tokens(conn: &Connection) {
    let current_settings = settings::get_app_settings(conn).unwrap_or_default();

    let providers = current_settings.providers.unwrap_or_else(|| ProvidersSettings {
        default_provider: ProviderType::Claude,
        claude: ClaudeProviderSettings {
            enabled: true,
            cli_path: None,
            default_model: "sonnet".to_string(),
        },
        copilot: CopilotProviderSettings {
            enabled: false,
            authenticated: false,
            access_token: None,
            refresh_token: None,
            token_expiry: None,
            default_model: "gpt-4.1".to_string(),
            username: None,
        },
    });

    let updated_providers = ProvidersSettings {
        default_provider: providers.default_provider,
        claude: providers.claude,
        copilot: CopilotProviderSettings {
            enabled: false,
            authenticated: false,
            access_token: None,
            refresh_token: None,
            token_expiry: None,
            default_model: providers.copilot.default_model,
            username: None,
        },
    };

    let update = serde_json::json!({
        "providers": serde_json::to_value(&updated_providers).unwrap_or_default(),
    });

    if let Err(e) = settings::update_app_settings(conn, &update) {
        error!("copilot-auth: failed to clear tokens: {}", e);
    } else {
        info!("copilot-auth: tokens cleared");
    }
}
