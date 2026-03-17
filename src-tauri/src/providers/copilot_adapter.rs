use std::collections::HashMap;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tracing::info;

use crate::db::models::ModelInfo;

use super::copilot_auth;
use super::tool_executor::{execute_tool, TOOL_DEFINITIONS};
use super::types::{
    AgentRunOptions, AgentStatus, ModelTokenUsage,
    ToolCallMessage, COPILOT_PREMIUM_REQUEST_USD,
};

// ── Constants ────────────────────────────────────────────────

const COPILOT_CHAT_URL: &str = "https://api.githubcopilot.com/chat/completions";
const COPILOT_RESPONSES_URL: &str = "https://api.githubcopilot.com/v1/responses";
const MAX_ITERATIONS: usize = 50;

// ── Copilot Adapter ──────────────────────────────────────────

pub struct CopilotAdapter {
    abort_handle: parking_lot::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    copilot_token: parking_lot::Mutex<Option<(String, u64)>>, // (token, expires_at_ms)
}

impl CopilotAdapter {
    pub fn new() -> Self {
        Self {
            abort_handle: parking_lot::Mutex::new(None),
            copilot_token: parking_lot::Mutex::new(None),
        }
    }

    /// Check if user is authenticated with GitHub Copilot.
    pub fn is_available(conn: &rusqlite::Connection) -> bool {
        copilot_auth::is_authenticated(conn)
    }

    /// Return the Copilot model catalog.
    pub fn get_models() -> Vec<ModelInfo> {
        super::types::copilot_models()
    }

    /// Determine whether a model uses the /responses endpoint.
    pub fn is_responses_model(model_id: &str) -> bool {
        let models = super::types::copilot_models();
        models
            .iter()
            .find(|m| m.id == model_id)
            .and_then(|m| m.responses_api)
            .unwrap_or(false)
    }

    /// Run the Copilot agent, dispatching to the correct API path.
    /// Returns a receiver for streamed `ToolCallMessage` events.
    pub async fn run_agent(
        &self,
        options: AgentRunOptions,
        access_token: &str,
    ) -> mpsc::Receiver<ToolCallMessage> {
        let (tx, rx) = mpsc::channel::<ToolCallMessage>(256);
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

        {
            let mut guard = self.abort_handle.lock();
            *guard = Some(cancel_tx);
        }

        let use_responses = Self::is_responses_model(&options.provider.model);
        let access_token = access_token.to_string();
        let copilot_token_cache = self.copilot_token.lock().clone();

        tokio::spawn(async move {
            // Ensure we have a valid copilot token
            let copilot_token = match ensure_copilot_token(&access_token, copilot_token_cache).await
            {
                Ok(t) => t,
                Err(e) => {
                    let _ = tx.send(ToolCallMessage::error(&e.to_string())).await;
                    let _ = tx.send(ToolCallMessage::failed(&e.to_string())).await;
                    return;
                }
            };

            let result = if use_responses {
                run_agent_responses(tx.clone(), cancel_rx, options, &copilot_token).await
            } else {
                run_agent_chat(tx.clone(), cancel_rx, options, &copilot_token).await
            };

            if let Err(e) = result {
                let _ = tx.send(ToolCallMessage::error(&e.to_string())).await;
                let _ = tx.send(ToolCallMessage::failed(&e.to_string())).await;
            }
        });

        rx
    }

    /// Cancel any running agent.
    pub fn cancel(&self) {
        let mut guard = self.abort_handle.lock();
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
}

// ── Token management ─────────────────────────────────────────

async fn ensure_copilot_token(
    access_token: &str,
    cached: Option<(String, u64)>,
) -> anyhow::Result<String> {
    // Check if we have a cached token that hasn't expired
    if let Some((token, expires_at_ms)) = cached {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if now_ms < expires_at_ms.saturating_sub(60_000) {
            return Ok(token);
        }
    }

    let result = copilot_auth::get_copilot_token(access_token).await?;
    Ok(result.token)
}

// ── HTTP Helpers ─────────────────────────────────────────────

fn build_copilot_headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    headers.insert(
        "Editor-Version",
        HeaderValue::from_static("vscode/1.107.0"),
    );
    headers.insert(
        "Editor-Plugin-Version",
        HeaderValue::from_static("copilot-chat/0.35.0"),
    );
    headers.insert(
        "Copilot-Integration-Id",
        HeaderValue::from_static("vscode-chat"),
    );
    headers.insert(
        "x-github-api-version",
        HeaderValue::from_static("2025-04-01"),
    );
    headers.insert(
        "x-request-id",
        HeaderValue::from_str(&uuid::Uuid::new_v4().to_string()).unwrap(),
    );
    headers
}

/// Build tool definitions in /chat/completions format (nested under `function`).
fn build_chat_tools() -> Vec<Value> {
    TOOL_DEFINITIONS
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        })
        .collect()
}

/// Build tool definitions in /responses format (flat, strict-compatible).
fn build_responses_tools() -> Vec<Value> {
    TOOL_DEFINITIONS
        .iter()
        .map(|tool| {
            let schema = &tool.input_schema;
            let required_arr = schema
                .get("required")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let required_set: std::collections::HashSet<String> = required_arr
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();

            let properties = schema
                .get("properties")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            let all_keys: Vec<String> = properties.keys().cloned().collect();

            // For strict mode: all properties in `required`, optional ones become nullable
            let mut strict_properties = serde_json::Map::new();
            for (key, prop) in &properties {
                if required_set.contains(key) {
                    strict_properties.insert(key.clone(), prop.clone());
                } else {
                    // Make optional properties nullable
                    let mut p = prop.clone();
                    if let Some(obj) = p.as_object_mut() {
                        if let Some(type_val) = obj.get("type").and_then(|v| v.as_str()) {
                            obj.insert(
                                "type".to_string(),
                                json!([type_val, "null"]),
                            );
                        }
                    }
                    strict_properties.insert(key.clone(), p);
                }
            }

            json!({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": {
                    "type": "object",
                    "properties": strict_properties,
                    "required": all_keys,
                    "additionalProperties": false,
                },
                "strict": true,
            })
        })
        .collect()
}

// ── SSE Parsing ──────────────────────────────────────────────

struct SseParseResult {
    lines: Vec<String>,
    remaining: String,
}

fn parse_sse_lines(buffer: &str) -> SseParseResult {
    let parts: Vec<&str> = buffer.split('\n').collect();
    let remaining = parts.last().copied().unwrap_or("").to_string();
    let lines: Vec<String> = parts[..parts.len().saturating_sub(1)]
        .iter()
        .filter_map(|line| {
            if let Some(data) = line.strip_prefix("data: ") {
                Some(data.trim().to_string())
            } else {
                None
            }
        })
        .collect();
    SseParseResult { lines, remaining }
}

// ── /chat/completions path ───────────────────────────────────

async fn run_agent_chat(
    tx: mpsc::Sender<ToolCallMessage>,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    options: AgentRunOptions,
    copilot_token: &str,
) -> anyhow::Result<()> {
    let AgentRunOptions {
        prompt,
        cwd,
        provider,
        system_prompt,
        permission_mode,
        ..
    } = options;

    info!(model = %provider.model, "copilot-adapter: starting chat agent");

    let default_system = format!(
        "You are a helpful coding assistant. You have access to tools to read, write, and \
         edit files, run commands, and search the codebase. Use these tools to help the user \
         with their request. Current working directory: {}",
        cwd
    );
    let system = system_prompt.unwrap_or(default_system);

    let mut messages: Vec<Value> = vec![
        json!({"role": "system", "content": system}),
        json!({"role": "user", "content": prompt}),
    ];

    let tools = build_chat_tools();
    let client = reqwest::Client::new();
    let mut total_tokens_in: i64 = 0;
    let mut total_tokens_out: i64 = 0;
    let mut block_index: i32 = 0;

    for iteration in 0..MAX_ITERATIONS {
        // Check cancel before each iteration
        if cancel_rx.try_recv().is_ok() {
            let _ = tx.send(ToolCallMessage::failed("Request cancelled")).await;
            return Ok(());
        }

        let headers = build_copilot_headers(copilot_token);
        let body = json!({
            "model": provider.model,
            "messages": messages,
            "tools": tools,
            "stream": true,
            "max_tokens": 16384,
        });

        let response = client
            .post(COPILOT_CHAT_URL)
            .headers(headers)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("Copilot API error: {} - {}", status, error_text);
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut current_content = String::new();
        let mut current_tool_calls: HashMap<usize, ToolCallAccumulator> = HashMap::new();
        let mut finish_reason: Option<String> = None;
        let decoder = &mut String::new();

        use futures::StreamExt;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    let _ = tx.send(ToolCallMessage::failed("Request cancelled")).await;
                    return Ok(());
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            // Decode bytes to string (UTF-8)
                            decoder.clear();
                            decoder.push_str(&String::from_utf8_lossy(&bytes));
                            buffer.push_str(decoder);

                            let parsed = parse_sse_lines(&buffer);
                            buffer = parsed.remaining;

                            for data in parsed.lines {
                                if data == "[DONE]" {
                                    continue;
                                }

                                let chunk_val: Value = match serde_json::from_str(&data) {
                                    Ok(v) => v,
                                    Err(_) => continue,
                                };

                                // Extract choice
                                let choice = match chunk_val.get("choices")
                                    .and_then(|c| c.as_array())
                                    .and_then(|a| a.first())
                                {
                                    Some(c) => c,
                                    None => continue,
                                };

                                // Content delta
                                if let Some(content) = choice
                                    .get("delta")
                                    .and_then(|d| d.get("content"))
                                    .and_then(|c| c.as_str())
                                {
                                    current_content.push_str(content);
                                    let _ = tx.send(ToolCallMessage::text(
                                        content,
                                        true,
                                        block_index,
                                    )).await;
                                }

                                // Tool call deltas
                                if let Some(tcs) = choice
                                    .get("delta")
                                    .and_then(|d| d.get("tool_calls"))
                                    .and_then(|t| t.as_array())
                                {
                                    for tc in tcs {
                                        let idx = tc.get("index")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0) as usize;

                                        let entry = current_tool_calls
                                            .entry(idx)
                                            .or_insert_with(ToolCallAccumulator::default);

                                        if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                            entry.id = id.to_string();
                                        }
                                        if let Some(name) = tc
                                            .get("function")
                                            .and_then(|f| f.get("name"))
                                            .and_then(|n| n.as_str())
                                        {
                                            entry.name = name.to_string();
                                        }
                                        if let Some(args) = tc
                                            .get("function")
                                            .and_then(|f| f.get("arguments"))
                                            .and_then(|a| a.as_str())
                                        {
                                            entry.arguments.push_str(args);
                                        }
                                    }
                                }

                                // Usage
                                if let Some(usage) = chunk_val.get("usage") {
                                    total_tokens_in += usage
                                        .get("prompt_tokens")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0);
                                    total_tokens_out += usage
                                        .get("completion_tokens")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0);
                                }

                                // Finish reason
                                if let Some(fr) = choice
                                    .get("finish_reason")
                                    .and_then(|v| v.as_str())
                                {
                                    finish_reason = Some(fr.to_string());
                                }
                            }
                        }
                        Some(Err(e)) => {
                            anyhow::bail!("Stream read error: {}", e);
                        }
                        None => break,
                    }
                }
            }
        }

        info!(
            iteration,
            text_len = current_content.len(),
            tool_calls = current_tool_calls.len(),
            finish_reason = ?finish_reason,
            "copilot-adapter: chat iteration"
        );

        // Process tool calls
        if finish_reason.as_deref() == Some("tool_calls") && !current_tool_calls.is_empty() {
            // Build tool_calls array for assistant message
            let tool_calls_json: Vec<Value> = current_tool_calls
                .values()
                .map(|tc| {
                    json!({
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                    })
                })
                .collect();

            messages.push(json!({
                "role": "assistant",
                "content": current_content,
                "tool_calls": tool_calls_json,
            }));

            for tc in current_tool_calls.values() {
                block_index += 1;
                let tool_input: Value = serde_json::from_str(&tc.arguments)
                    .unwrap_or(Value::Object(serde_json::Map::new()));

                let _ = tx
                    .send(ToolCallMessage::tool_use(
                        &tc.id,
                        &tc.name,
                        tool_input.clone(),
                        block_index,
                    ))
                    .await;

                let result = execute_tool(&tc.name, &tool_input, &cwd, &permission_mode).await;
                let _ = tx
                    .send(ToolCallMessage::tool_result(&tc.id, &tc.name, &result.output))
                    .await;

                messages.push(json!({
                    "role": "tool",
                    "content": result.output,
                    "tool_call_id": tc.id,
                }));

                block_index += 1;
            }

            continue;
        }

        // No tool calls -- we're done
        if !current_content.is_empty() {
            messages.push(json!({"role": "assistant", "content": current_content}));
        }
        break;
    }

    // Emit final cost + completed status
    emit_final_cost(&tx, &provider.model, total_tokens_in, total_tokens_out).await;

    Ok(())
}

// ── /v1/responses path ───────────────────────────────────────

async fn run_agent_responses(
    tx: mpsc::Sender<ToolCallMessage>,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    options: AgentRunOptions,
    copilot_token: &str,
) -> anyhow::Result<()> {
    let AgentRunOptions {
        prompt,
        cwd,
        provider,
        system_prompt,
        permission_mode,
        ..
    } = options;

    info!(model = %provider.model, "copilot-adapter: starting responses agent");

    let default_instructions = format!(
        "You are a helpful coding assistant. You have access to tools to read, write, and \
         edit files, run commands, and search the codebase. Use these tools to help the user \
         with their request. Current working directory: {}",
        cwd
    );
    let instructions = system_prompt.unwrap_or(default_instructions);

    let mut input: Vec<Value> = vec![json!({
        "role": "user",
        "content": [{"type": "input_text", "text": prompt}],
    })];

    let tools = build_responses_tools();
    let client = reqwest::Client::new();
    let mut total_tokens_in: i64 = 0;
    let mut total_tokens_out: i64 = 0;
    let mut block_index: i32 = 0;

    for iteration in 0..MAX_ITERATIONS {
        if cancel_rx.try_recv().is_ok() {
            let _ = tx.send(ToolCallMessage::failed("Request cancelled")).await;
            return Ok(());
        }

        let headers = build_copilot_headers(copilot_token);
        let body = json!({
            "model": provider.model,
            "input": input,
            "instructions": instructions,
            "tools": tools,
            "stream": true,
            "max_output_tokens": 16384,
            "parallel_tool_calls": false,
            "store": false,
        });

        let response = client
            .post(COPILOT_RESPONSES_URL)
            .headers(headers)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            anyhow::bail!("Copilot Responses API error: {} - {}", status, error_text);
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut current_text = String::new();
        let mut function_calls: HashMap<usize, FunctionCallAccumulator> = HashMap::new();
        let mut response_completed = false;

        use futures::StreamExt;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    let _ = tx.send(ToolCallMessage::failed("Request cancelled")).await;
                    return Ok(());
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            buffer.push_str(&String::from_utf8_lossy(&bytes));

                            let parsed = parse_sse_lines(&buffer);
                            buffer = parsed.remaining;

                            for data in parsed.lines {
                                if data == "[DONE]" {
                                    continue;
                                }

                                let event: Value = match serde_json::from_str(&data) {
                                    Ok(v) => v,
                                    Err(_) => continue,
                                };

                                let event_type = event.get("type")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");

                                match event_type {
                                    "response.output_text.delta" => {
                                        if let Some(delta) = event.get("delta").and_then(|v| v.as_str()) {
                                            current_text.push_str(delta);
                                            let _ = tx.send(ToolCallMessage::text(
                                                delta, true, block_index,
                                            )).await;
                                        }
                                    }

                                    "response.output_item.added" => {
                                        if let Some(item) = event.get("item") {
                                            let item_type = item.get("type")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("");
                                            if item_type == "function_call" {
                                                if let Some(output_index) = event
                                                    .get("output_index")
                                                    .and_then(|v| v.as_u64())
                                                {
                                                    let call_id = item
                                                        .get("call_id")
                                                        .and_then(|v| v.as_str())
                                                        .unwrap_or("")
                                                        .to_string();
                                                    let call_id = if call_id.is_empty() {
                                                        format!("call_{}", output_index)
                                                    } else {
                                                        call_id
                                                    };
                                                    let name = item
                                                        .get("name")
                                                        .and_then(|v| v.as_str())
                                                        .unwrap_or("")
                                                        .to_string();
                                                    function_calls.insert(
                                                        output_index as usize,
                                                        FunctionCallAccumulator {
                                                            call_id,
                                                            name,
                                                            arguments: String::new(),
                                                        },
                                                    );
                                                }
                                            }
                                        }
                                    }

                                    "response.function_call_arguments.delta" => {
                                        if let (Some(idx), Some(delta)) = (
                                            event.get("output_index").and_then(|v| v.as_u64()),
                                            event.get("delta").and_then(|v| v.as_str()),
                                        ) {
                                            if let Some(fc) = function_calls.get_mut(&(idx as usize)) {
                                                fc.arguments.push_str(delta);
                                            }
                                        }
                                    }

                                    "response.function_call_arguments.done" => {
                                        if let (Some(idx), Some(args)) = (
                                            event.get("output_index").and_then(|v| v.as_u64()),
                                            event.get("arguments").and_then(|v| v.as_str()),
                                        ) {
                                            if let Some(fc) = function_calls.get_mut(&(idx as usize)) {
                                                fc.arguments = args.to_string();
                                            }
                                        }
                                    }

                                    "response.completed" => {
                                        response_completed = true;
                                        if let Some(usage) = event
                                            .get("response")
                                            .and_then(|r| r.get("usage"))
                                        {
                                            total_tokens_in += usage
                                                .get("input_tokens")
                                                .and_then(|v| v.as_i64())
                                                .unwrap_or(0);
                                            total_tokens_out += usage
                                                .get("output_tokens")
                                                .and_then(|v| v.as_i64())
                                                .unwrap_or(0);
                                        }
                                        // Fallback: extract function calls from response.output
                                        if function_calls.is_empty() {
                                            if let Some(output) = event
                                                .get("response")
                                                .and_then(|r| r.get("output"))
                                                .and_then(|o| o.as_array())
                                            {
                                                for (idx, item) in output.iter().enumerate() {
                                                    let item_type = item
                                                        .get("type")
                                                        .and_then(|v| v.as_str())
                                                        .unwrap_or("");
                                                    if item_type == "function_call" {
                                                        let name = item
                                                            .get("name")
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("")
                                                            .to_string();
                                                        let call_id = item
                                                            .get("call_id")
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("")
                                                            .to_string();
                                                        let arguments = item
                                                            .get("arguments")
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("{}")
                                                            .to_string();
                                                        function_calls.insert(idx, FunctionCallAccumulator {
                                                            call_id,
                                                            name,
                                                            arguments,
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    "response.failed" => {
                                        let err_msg = event
                                            .get("response")
                                            .and_then(|r| r.get("error"))
                                            .and_then(|e| e.get("message"))
                                            .and_then(|m| m.as_str())
                                            .unwrap_or("Responses API failed");
                                        anyhow::bail!("{}", err_msg);
                                    }

                                    _ => {}
                                }
                            }
                        }
                        Some(Err(e)) => {
                            anyhow::bail!("Stream read error: {}", e);
                        }
                        None => break,
                    }
                }
            }
        }

        info!(
            iteration,
            text_len = current_text.len(),
            function_calls = function_calls.len(),
            response_completed,
            "copilot-adapter: responses iteration"
        );

        // Process function calls
        if !function_calls.is_empty() {
            // Add assistant output to input history
            if !current_text.is_empty() {
                input.push(json!({
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": current_text}],
                }));
            }

            for fc in function_calls.values() {
                // Add function_call to input
                input.push(json!({
                    "type": "function_call",
                    "call_id": fc.call_id,
                    "name": fc.name,
                    "arguments": fc.arguments,
                }));

                block_index += 1;
                let tool_input: Value = serde_json::from_str(&fc.arguments)
                    .unwrap_or(Value::Object(serde_json::Map::new()));

                let _ = tx
                    .send(ToolCallMessage::tool_use(
                        &fc.call_id,
                        &fc.name,
                        tool_input.clone(),
                        block_index,
                    ))
                    .await;

                let result = execute_tool(&fc.name, &tool_input, &cwd, &permission_mode).await;
                let _ = tx
                    .send(ToolCallMessage::tool_result(&fc.call_id, &fc.name, &result.output))
                    .await;

                // Add function_call_output to input
                input.push(json!({
                    "type": "function_call_output",
                    "call_id": fc.call_id,
                    "output": result.output,
                }));

                block_index += 1;
            }

            continue;
        }

        // No function calls -- done
        break;
    }

    emit_final_cost(&tx, &provider.model, total_tokens_in, total_tokens_out).await;

    Ok(())
}

// ── Shared helpers ───────────────────────────────────────────

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

struct FunctionCallAccumulator {
    call_id: String,
    name: String,
    arguments: String,
}

async fn emit_final_cost(
    tx: &mpsc::Sender<ToolCallMessage>,
    model: &str,
    tokens_in: i64,
    tokens_out: i64,
) {
    let models = super::types::copilot_models();
    let multiplier = models
        .iter()
        .find(|m| m.id == model)
        .and_then(|m| m.premium_multiplier)
        .unwrap_or(1.0);

    let estimated_cost = COPILOT_PREMIUM_REQUEST_USD * multiplier;

    let mut model_usage = HashMap::new();
    model_usage.insert(
        model.to_string(),
        ModelTokenUsage {
            input_tokens: tokens_in,
            output_tokens: tokens_out,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cost_usd: estimated_cost,
        },
    );

    let _ = tx
        .send(ToolCallMessage::cost(
            estimated_cost,
            tokens_in,
            tokens_out,
            Some(model_usage),
        ))
        .await;

    let _ = tx.send(ToolCallMessage::status(AgentStatus::Completed)).await;
}
