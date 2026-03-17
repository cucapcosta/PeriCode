use std::collections::{HashMap, HashSet};

use serde_json::Value;
use tokio::sync::mpsc;
use tracing::{info, error};

use crate::db::models::ModelInfo;

use super::types::{
    AgentRunOptions, AgentStatus, ModelTokenUsage, PermissionMode,
    ToolCallMessage,
};

// ── Constants ────────────────────────────────────────────────

const DEFAULT_TOOLS: &[&str] = &[
    "Read", "Edit", "Write", "Bash",
    "Glob", "Grep", "WebSearch", "WebFetch",
];

const DISALLOWED_TOOLS: &[&str] = &["EnterPlanMode"];

const NON_INTERACTIVE_SYSTEM_PROMPT: &str =
    "You are running in non-interactive print mode. \
     DO NOT enter plan mode. Implement all requested changes directly. \
     Write code, create files, and make edits immediately without asking for confirmation.";

// ── Claude Adapter ───────────────────────────────────────────

pub struct ClaudeAdapter {
    /// Handle to cancel a running agent process.
    cancel_tx: parking_lot::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl ClaudeAdapter {
    pub fn new() -> Self {
        Self {
            cancel_tx: parking_lot::Mutex::new(None),
        }
    }

    /// Check if the Claude CLI is available on the system.
    pub async fn is_available(cli_path: Option<&str>) -> bool {
        let path = cli_path.unwrap_or("claude");
        let result = tokio::process::Command::new(path)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        matches!(result, Ok(status) if status.success())
    }

    /// Return the Claude model catalog.
    pub fn get_models() -> Vec<ModelInfo> {
        super::types::claude_models()
    }

    /// Resolve the permission mode string for the Claude CLI flag.
    fn resolve_permission_mode(mode: &PermissionMode) -> &'static str {
        match mode {
            PermissionMode::Full => "bypassPermissions",
            PermissionMode::Ask => "acceptEdits",
            PermissionMode::AcceptEdits => "bypassPermissions",
        }
    }

    /// Prepend image references to the prompt if any.
    fn build_prompt_with_images(prompt: &str, image_paths: Option<&[String]>) -> String {
        match image_paths {
            Some(paths) if !paths.is_empty() => {
                let refs: Vec<String> = paths
                    .iter()
                    .map(|p| format!("[Image: {}]", p.replace('\\', "/")))
                    .collect();
                format!("{}\n\n{}", refs.join("\n"), prompt)
            }
            _ => prompt.to_string(),
        }
    }

    /// Run the Claude CLI agent, streaming `ToolCallMessage` events through
    /// the returned `mpsc::Receiver`.
    ///
    /// The actual subprocess spawning is delegated to the `claude_cli` service
    /// (which should be implemented in `services/claude_cli.rs`). This method
    /// builds the CLI arguments, spawns the process, and converts the
    /// JSON-stream CLI events into our unified `ToolCallMessage` format.
    pub async fn run_agent(
        &self,
        options: AgentRunOptions,
        cli_path: Option<String>,
    ) -> mpsc::Receiver<ToolCallMessage> {
        let (tx, rx) = mpsc::channel::<ToolCallMessage>(256);
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

        {
            let mut guard = self.cancel_tx.lock();
            *guard = Some(cancel_tx);
        }

        let prompt = Self::build_prompt_with_images(
            &options.prompt,
            options.image_paths.as_deref(),
        );
        let model = options.provider.model.clone();
        let cwd = options.cwd.clone();
        let resume = options.resume_session_id.clone();
        let perm_mode = Self::resolve_permission_mode(&options.permission_mode);
        let allowed = options
            .allowed_tools
            .clone()
            .unwrap_or_else(|| DEFAULT_TOOLS.iter().map(|s| s.to_string()).collect());
        let disallowed = options
            .disallowed_tools
            .clone()
            .unwrap_or_else(|| DISALLOWED_TOOLS.iter().map(|s| s.to_string()).collect());
        let system_prompt = options
            .system_prompt
            .clone()
            .unwrap_or_else(|| NON_INTERACTIVE_SYSTEM_PROMPT.to_string());

        let claude_path = cli_path.unwrap_or_else(|| "claude".to_string());

        tokio::spawn(async move {
            let result = Self::run_cli_process(
                tx.clone(),
                cancel_rx,
                &claude_path,
                &prompt,
                &cwd,
                &model,
                resume.as_deref(),
                perm_mode,
                &allowed,
                &disallowed,
                &system_prompt,
            )
            .await;

            if let Err(e) = result {
                let _ = tx.send(ToolCallMessage::error(&e.to_string())).await;
                let _ = tx.send(ToolCallMessage::failed(&e.to_string())).await;
            }
        });

        rx
    }

    /// Cancel any running agent.
    pub fn cancel(&self) {
        let mut guard = self.cancel_tx.lock();
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }

    // ── Internal: spawn and parse Claude CLI ────────────────

    #[allow(clippy::too_many_arguments)]
    async fn run_cli_process(
        tx: mpsc::Sender<ToolCallMessage>,
        mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
        claude_path: &str,
        prompt: &str,
        cwd: &str,
        model: &str,
        resume_session_id: Option<&str>,
        permission_mode: &str,
        allowed_tools: &[String],
        disallowed_tools: &[String],
        system_prompt: &str,
    ) -> anyhow::Result<()> {
        use tokio::io::AsyncBufReadExt;

        let mut cmd = tokio::process::Command::new(claude_path);
        cmd.current_dir(cwd);

        // Build arguments
        cmd.args(["--print", "--output-format", "stream-json"]);
        cmd.arg("--model").arg(model);
        cmd.arg("--permission-mode").arg(permission_mode);
        cmd.arg("--append-system-prompt").arg(system_prompt);

        for tool in allowed_tools {
            cmd.arg("--allowedTools").arg(tool);
        }
        for tool in disallowed_tools {
            cmd.arg("--disallowedTools").arg(tool);
        }

        if let Some(sid) = resume_session_id {
            cmd.arg("--resume").arg(sid);
        }

        cmd.arg("--prompt").arg(prompt);

        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());
        cmd.stdin(std::process::Stdio::null());

        info!(model, cwd, "claude-adapter: starting CLI process");

        let mut child = cmd.spawn()?;

        let stdout = child.stdout.take().ok_or_else(|| {
            anyhow::anyhow!("Failed to capture stdout from Claude CLI")
        })?;

        let reader = tokio::io::BufReader::new(stdout);
        let mut lines = reader.lines();

        let mut state = StreamState {
            last_seen_text_length: 0,
            current_block_index: 0,
            seen_tool_use_ids: HashSet::new(),
        };

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    let _ = child.kill().await;
                    let _ = tx.send(ToolCallMessage::failed("Request cancelled")).await;
                    return Ok(());
                }
                line = lines.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<Value>(trimmed) {
                                Ok(event) => {
                                    let messages = convert_cli_event_to_messages(&event, &mut state);
                                    for msg in messages {
                                        if tx.send(msg).await.is_err() {
                                            let _ = child.kill().await;
                                            return Ok(());
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::debug!("Ignoring unparseable CLI line: {}", e);
                                }
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            error!("Error reading CLI stdout: {}", e);
                            break;
                        }
                    }
                }
            }
        }

        let status = child.wait().await?;
        if !status.success() {
            tracing::warn!(exit_code = ?status.code(), "Claude CLI exited with non-zero status");
        }

        Ok(())
    }
}

// ── Stream State for CLI Event Conversion ────────────────────

struct StreamState {
    last_seen_text_length: usize,
    current_block_index: i32,
    seen_tool_use_ids: HashSet<String>,
}

/// Convert a single CLI JSON event into zero or more `ToolCallMessage`s.
///
/// This mirrors the TypeScript `convertCliEventToMessages` generator.
fn convert_cli_event_to_messages(
    event: &Value,
    state: &mut StreamState,
) -> Vec<ToolCallMessage> {
    let mut messages = Vec::new();

    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "system" => {
            let subtype = event.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
            if subtype == "init" {
                if let Some(session_id) = event.get("session_id").and_then(|v| v.as_str()) {
                    messages.push(ToolCallMessage::system_init(session_id));
                }
            }
        }

        "assistant" => {
            // Handle content_block partials
            if let Some(content_block) = event.get("content_block") {
                let block_type = content_block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                if block_type == "text" {
                    if let Some(full_text) = content_block.get("text").and_then(|v| v.as_str()) {
                        let delta = &full_text[state.last_seen_text_length..];
                        state.last_seen_text_length = full_text.len();

                        if !delta.is_empty() {
                            messages.push(ToolCallMessage::text(
                                delta,
                                true,
                                state.current_block_index,
                            ));
                        }
                    }
                }

                if block_type == "tool_use" {
                    if let Some(tool_name) = content_block.get("name").and_then(|v| v.as_str()) {
                        let tool_id = content_block.get("id").and_then(|v| v.as_str());
                        let tool_input = content_block
                            .get("input")
                            .cloned()
                            .unwrap_or(Value::Object(serde_json::Map::new()));

                        let dedupe_key = tool_id
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| format!("{}-{}", tool_name, tool_input));

                        if !state.seen_tool_use_ids.contains(&dedupe_key) {
                            state.seen_tool_use_ids.insert(dedupe_key);
                            state.current_block_index += 1;
                            state.last_seen_text_length = 0;

                            messages.push(ToolCallMessage::tool_use(
                                tool_id.unwrap_or(""),
                                tool_name,
                                tool_input,
                                state.current_block_index,
                            ));

                            state.current_block_index += 1;
                        }
                    }
                }
            }

            // Handle full message.content snapshots
            if let Some(message) = event.get("message") {
                if let Some(content) = message.get("content").and_then(|v| v.as_array()) {
                    for block in content {
                        let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                        if block_type == "text" {
                            if let Some(full_text) = block.get("text").and_then(|v| v.as_str()) {
                                let delta = &full_text[state.last_seen_text_length..];
                                state.last_seen_text_length = full_text.len();

                                if !delta.is_empty() {
                                    messages.push(ToolCallMessage::text(
                                        delta,
                                        true,
                                        state.current_block_index,
                                    ));
                                }
                            }
                        } else if block_type == "tool_use" {
                            let tool_id = block.get("id").and_then(|v| v.as_str());
                            let tool_name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            let tool_input = block
                                .get("input")
                                .cloned()
                                .unwrap_or(Value::Object(serde_json::Map::new()));

                            let dedupe_key = tool_id
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("{}-{}", tool_name, tool_input));

                            if !state.seen_tool_use_ids.contains(&dedupe_key) {
                                state.seen_tool_use_ids.insert(dedupe_key);
                                state.current_block_index += 1;
                                state.last_seen_text_length = 0;

                                messages.push(ToolCallMessage::tool_use(
                                    tool_id.unwrap_or(""),
                                    tool_name,
                                    tool_input,
                                    state.current_block_index,
                                ));

                                state.current_block_index += 1;
                            }
                        }
                    }
                }
            }
        }

        "result" => {
            // Parse model usage
            let model_usage: Option<HashMap<String, ModelTokenUsage>> =
                event.get("modelUsage").and_then(|mu| {
                    let obj = mu.as_object()?;
                    let mut map = HashMap::new();
                    for (model, u) in obj {
                        map.insert(
                            model.clone(),
                            ModelTokenUsage {
                                input_tokens: u.get("inputTokens").and_then(|v| v.as_i64()).unwrap_or(0),
                                output_tokens: u.get("outputTokens").and_then(|v| v.as_i64()).unwrap_or(0),
                                cache_read_input_tokens: u
                                    .get("cacheReadInputTokens")
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(0),
                                cache_creation_input_tokens: u
                                    .get("cacheCreationInputTokens")
                                    .and_then(|v| v.as_i64())
                                    .unwrap_or(0),
                                cost_usd: u.get("costUSD").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            },
                        );
                    }
                    Some(map)
                });

            let total_cost = event
                .get("total_cost_usd")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let tokens_in = event
                .get("usage")
                .and_then(|u| u.get("input_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let tokens_out = event
                .get("usage")
                .and_then(|u| u.get("output_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            messages.push(ToolCallMessage::cost(total_cost, tokens_in, tokens_out, model_usage));

            let subtype = event.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
            let is_success = subtype == "success";

            let mut status_msg = if is_success {
                ToolCallMessage::status(AgentStatus::Completed)
            } else {
                ToolCallMessage::status(AgentStatus::Failed)
            };

            if let Some(result_text) = event.get("result").and_then(|v| v.as_str()) {
                status_msg.text = Some(result_text.to_string());
            }

            messages.push(status_msg);
        }

        _ => {}
    }

    messages
}
