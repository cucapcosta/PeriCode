use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::db::models::{ModelInfo, ProviderType};

// ── Provider Config ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: ProviderType,
    pub model: String,
}

// ── Tool Definitions ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

// ── Unified Message Types ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallMessageType {
    Text,
    ToolUse,
    ToolResult,
    Cost,
    Status,
    Error,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Init,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallMessage {
    #[serde(rename = "type")]
    pub type_: ToolCallMessageType,

    // Text content
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_partial: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_index: Option<i32>,

    // Tool use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<serde_json::Value>,

    // Tool result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<String>,

    // Cost tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_in: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_out: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_usage: Option<HashMap<String, ModelTokenUsage>>,

    // Status
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<AgentStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

impl ToolCallMessage {
    /// Create a text message (partial streaming delta).
    pub fn text(text: &str, is_partial: bool, block_index: i32) -> Self {
        Self {
            type_: ToolCallMessageType::Text,
            text: Some(text.to_string()),
            is_partial: Some(is_partial),
            block_index: Some(block_index),
            ..Default::default()
        }
    }

    /// Create a tool_use message.
    pub fn tool_use(tool_id: &str, tool_name: &str, tool_input: serde_json::Value, block_index: i32) -> Self {
        Self {
            type_: ToolCallMessageType::ToolUse,
            tool_id: Some(tool_id.to_string()),
            tool_name: Some(tool_name.to_string()),
            tool_input: Some(tool_input),
            block_index: Some(block_index),
            ..Default::default()
        }
    }

    /// Create a tool_result message.
    pub fn tool_result(tool_id: &str, tool_name: &str, output: &str) -> Self {
        Self {
            type_: ToolCallMessageType::ToolResult,
            tool_id: Some(tool_id.to_string()),
            tool_name: Some(tool_name.to_string()),
            tool_output: Some(output.to_string()),
            ..Default::default()
        }
    }

    /// Create a cost message.
    pub fn cost(
        cost_usd: f64,
        tokens_in: i64,
        tokens_out: i64,
        model_usage: Option<HashMap<String, ModelTokenUsage>>,
    ) -> Self {
        Self {
            type_: ToolCallMessageType::Cost,
            cost_usd: Some(cost_usd),
            tokens_in: Some(tokens_in),
            tokens_out: Some(tokens_out),
            model_usage,
            ..Default::default()
        }
    }

    /// Create a status message.
    pub fn status(status: AgentStatus) -> Self {
        Self {
            type_: ToolCallMessageType::Status,
            status: Some(status),
            ..Default::default()
        }
    }

    /// Create a system init message with session_id.
    pub fn system_init(session_id: &str) -> Self {
        Self {
            type_: ToolCallMessageType::System,
            status: Some(AgentStatus::Init),
            session_id: Some(session_id.to_string()),
            ..Default::default()
        }
    }

    /// Create an error message.
    pub fn error(message: &str) -> Self {
        Self {
            type_: ToolCallMessageType::Error,
            error_message: Some(message.to_string()),
            ..Default::default()
        }
    }

    /// Create a failed-status message with error details.
    pub fn failed(error_message: &str) -> Self {
        Self {
            type_: ToolCallMessageType::Status,
            status: Some(AgentStatus::Failed),
            error_message: Some(error_message.to_string()),
            ..Default::default()
        }
    }
}

impl Default for ToolCallMessage {
    fn default() -> Self {
        Self {
            type_: ToolCallMessageType::Text,
            text: None,
            is_partial: None,
            block_index: None,
            tool_id: None,
            tool_name: None,
            tool_input: None,
            tool_output: None,
            cost_usd: None,
            tokens_in: None,
            tokens_out: None,
            model: None,
            model_usage: None,
            status: None,
            session_id: None,
            error_message: None,
        }
    }
}

// ── Agent Run Options ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Ask,
    AcceptEdits,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunOptions {
    pub prompt: String,
    pub cwd: String,
    pub provider: ProviderConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_history: Option<Vec<ToolCallMessage>>,
    pub permission_mode: PermissionMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_paths: Option<Vec<String>>,

    // Tool configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<Vec<String>>,
}

// ── Model Catalogs ───────────────────────────────────────────

/// Claude CLI model catalog.
pub fn claude_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "opus".to_string(),
            name: "Claude Opus 4.6".to_string(),
            description: Some("Most capable, complex tasks".to_string()),
            responses_api: None,
            premium_multiplier: None,
        },
        ModelInfo {
            id: "sonnet".to_string(),
            name: "Claude Sonnet 4.5".to_string(),
            description: Some("Balanced performance".to_string()),
            responses_api: None,
            premium_multiplier: None,
        },
        ModelInfo {
            id: "haiku".to_string(),
            name: "Claude Haiku 4.5".to_string(),
            description: Some("Fast, lightweight".to_string()),
            responses_api: None,
            premium_multiplier: None,
        },
    ]
}

/// Premium request cost: $0.04 USD per 1x premium request.
pub const COPILOT_PREMIUM_REQUEST_USD: f64 = 0.04;

/// GitHub Copilot model catalog.
pub fn copilot_models() -> Vec<ModelInfo> {
    vec![
        // OpenAI Codex Models (require /responses API)
        ModelInfo {
            id: "gpt-5.3-codex".into(),
            name: "GPT-5.3 Codex".into(),
            description: Some("Newest codex model".into()),
            responses_api: Some(true),
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gpt-5.2-codex".into(),
            name: "GPT-5.2 Codex".into(),
            description: Some("Latest codex model".into()),
            responses_api: Some(true),
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gpt-5.1-codex-max".into(),
            name: "GPT-5.1 Codex Max".into(),
            description: Some("Max codex model".into()),
            responses_api: Some(true),
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gpt-5.1-codex".into(),
            name: "GPT-5.1 Codex".into(),
            description: Some("Codex model".into()),
            responses_api: Some(true),
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gpt-5.1-codex-mini".into(),
            name: "GPT-5.1 Codex Mini".into(),
            description: Some("Small codex model".into()),
            responses_api: Some(true),
            premium_multiplier: Some(0.33),
        },
        // OpenAI Chat Models (/chat/completions)
        ModelInfo {
            id: "gpt-5.2".into(),
            name: "GPT-5.2".into(),
            description: Some("Latest GPT flagship".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gpt-5.1".into(),
            name: "GPT-5.1".into(),
            description: Some("GPT-5.1 general purpose".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gpt-5".into(),
            name: "GPT-5".into(),
            description: Some("GPT-5".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gpt-5-mini".into(),
            name: "GPT-5 Mini".into(),
            description: Some("Fast and affordable".into()),
            responses_api: None,
            premium_multiplier: Some(0.0),
        },
        ModelInfo {
            id: "gpt-4.1".into(),
            name: "GPT-4.1".into(),
            description: Some("Fast general purpose".into()),
            responses_api: None,
            premium_multiplier: Some(0.0),
        },
        ModelInfo {
            id: "gpt-4o".into(),
            name: "GPT-4o".into(),
            description: Some("Multimodal".into()),
            responses_api: None,
            premium_multiplier: Some(0.0),
        },
        // OpenAI Reasoning Models (/chat/completions)
        ModelInfo {
            id: "o4-mini".into(),
            name: "o4 Mini".into(),
            description: Some("Fast reasoning".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "o3".into(),
            name: "o3".into(),
            description: Some("Advanced reasoning".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "o3-mini".into(),
            name: "o3 Mini".into(),
            description: Some("Compact reasoning".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        // Anthropic Models (via Copilot)
        ModelInfo {
            id: "claude-opus-4.6".into(),
            name: "Claude Opus 4.6".into(),
            description: Some("Most capable".into()),
            responses_api: None,
            premium_multiplier: Some(3.0),
        },
        ModelInfo {
            id: "claude-opus-4.5".into(),
            name: "Claude Opus 4.5".into(),
            description: Some("Previous gen most capable".into()),
            responses_api: None,
            premium_multiplier: Some(3.0),
        },
        ModelInfo {
            id: "claude-sonnet-4.5".into(),
            name: "Claude Sonnet 4.5".into(),
            description: Some("Balanced performance".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "claude-sonnet-4".into(),
            name: "Claude Sonnet 4".into(),
            description: Some("Previous gen balanced".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "claude-haiku-4.5".into(),
            name: "Claude Haiku 4.5".into(),
            description: Some("Fast, lightweight".into()),
            responses_api: None,
            premium_multiplier: Some(0.33),
        },
        // Google Models
        ModelInfo {
            id: "gemini-3-pro".into(),
            name: "Gemini 3 Pro".into(),
            description: Some("Google latest pro model".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        ModelInfo {
            id: "gemini-3-flash".into(),
            name: "Gemini 3 Flash".into(),
            description: Some("Google latest fast model".into()),
            responses_api: None,
            premium_multiplier: Some(0.33),
        },
        ModelInfo {
            id: "gemini-2.5-pro".into(),
            name: "Gemini 2.5 Pro".into(),
            description: Some("Google previous gen pro".into()),
            responses_api: None,
            premium_multiplier: Some(1.0),
        },
        // xAI Models
        ModelInfo {
            id: "grok-code-fast-1".into(),
            name: "Grok Code Fast 1".into(),
            description: Some("xAI fast coding model".into()),
            responses_api: None,
            premium_multiplier: Some(0.25),
        },
    ]
}

// ── Default Provider Settings ────────────────────────────────

use crate::db::models::{ClaudeProviderSettings, CopilotProviderSettings, ProvidersSettings};

/// Default providers settings matching the TypeScript `DEFAULT_PROVIDERS_SETTINGS`.
pub fn default_providers_settings() -> ProvidersSettings {
    ProvidersSettings {
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
    }
}
