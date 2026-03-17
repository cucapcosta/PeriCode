use std::collections::HashMap;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tracing::{error, info, warn};

// ── Types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliModelUsage {
    #[serde(rename = "inputTokens", default)]
    pub input_tokens: Option<i64>,
    #[serde(rename = "outputTokens", default)]
    pub output_tokens: Option<i64>,
    #[serde(rename = "cacheReadInputTokens", default)]
    pub cache_read_input_tokens: Option<i64>,
    #[serde(rename = "cacheCreationInputTokens", default)]
    pub cache_creation_input_tokens: Option<i64>,
    #[serde(rename = "costUSD", default)]
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub request: Option<CliControlRequest>,
    #[serde(default)]
    pub message: Option<CliMessage>,
    #[serde(default)]
    pub content_block: Option<CliContentBlock>,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub total_cost_usd: Option<f64>,
    #[serde(default)]
    pub usage: Option<CliUsage>,
    #[serde(rename = "modelUsage", default)]
    pub model_usage: Option<HashMap<String, CliModelUsage>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliControlRequest {
    pub subtype: String,
    #[serde(default)]
    pub tool_name: Option<String>,
    #[serde(default)]
    pub input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliMessage {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub content: Vec<CliMessageBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliMessageBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliContentBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliUsage {
    #[serde(default)]
    pub input_tokens: Option<i64>,
    #[serde(default)]
    pub output_tokens: Option<i64>,
}

#[derive(Debug)]
pub struct SpawnClaudeOptions {
    pub prompt: String,
    pub cwd: String,
    pub model: Option<String>,
    pub resume_session_id: Option<String>,
    pub permission_mode: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub disallowed_tools: Option<Vec<String>>,
    pub append_system_prompt: Option<String>,
    pub claude_path: Option<String>,
}

pub struct SpawnClaudeResult {
    /// Receiver for parsed CLI events streamed from stdout.
    pub events_rx: mpsc::Receiver<CliEvent>,
    /// Send `()` to kill the child process.
    pub kill_tx: oneshot::Sender<()>,
    /// Send JSON-serialized strings to the child's stdin.
    pub stdin_tx: mpsc::Sender<String>,
}

// ── Implementation ─────────────────────────────────────────

pub fn spawn_claude(options: SpawnClaudeOptions) -> Result<SpawnClaudeResult, std::io::Error> {
    let claude_bin = options.claude_path.as_deref().unwrap_or("claude");

    // Build argument list
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];

    if let Some(ref session_id) = options.resume_session_id {
        args.push("--resume".into());
        args.push(session_id.clone());
    }
    if let Some(ref model) = options.model {
        args.push("--model".into());
        args.push(model.clone());
    }
    if let Some(ref mode) = options.permission_mode {
        args.push("--permission-mode".into());
        args.push(mode.clone());
    }
    if let Some(ref tools) = options.allowed_tools {
        if !tools.is_empty() {
            args.push("--allowedTools".into());
            for tool in tools {
                args.push(tool.clone());
            }
        }
    }
    if let Some(ref tools) = options.disallowed_tools {
        if !tools.is_empty() {
            args.push("--disallowedTools".into());
            for tool in tools {
                args.push(tool.clone());
            }
        }
    }
    if let Some(ref prompt) = options.append_system_prompt {
        args.push("--append-system-prompt".into());
        args.push(prompt.clone());
    }

    info!(
        target: "claude-cli",
        "Spawning: {} {}",
        claude_bin,
        args.join(" ")
    );

    let mut child = Command::new(claude_bin)
        .args(&args)
        .current_dir(&options.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let mut stdin = child.stdin.take().expect("stdin should be piped");
    let stdout = child.stdout.take().expect("stdout should be piped");
    let stderr = child.stderr.take().expect("stderr should be piped");

    // Send the initial user message via stdin
    let initial_message = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": options.prompt,
        }
    });

    let (events_tx, events_rx) = mpsc::channel::<CliEvent>(256);
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(64);

    // Spawn stdin writer task
    tokio::spawn(async move {
        // Send initial message
        let line = serde_json::to_string(&initial_message).unwrap_or_default() + "\n";
        if let Err(e) = stdin.write_all(line.as_bytes()).await {
            warn!(target: "claude-cli", "Failed to send initial message: {}", e);
            return;
        }
        if let Err(e) = stdin.flush().await {
            warn!(target: "claude-cli", "Failed to flush initial message: {}", e);
            return;
        }
        info!(target: "claude-cli", "Sent initial user message via stdin");

        // Forward subsequent stdin messages
        while let Some(data) = stdin_rx.recv().await {
            info!(target: "claude-cli", "Wrote to stdin: {:.200}", data);
            let line = data + "\n";
            if let Err(e) = stdin.write_all(line.as_bytes()).await {
                warn!(target: "claude-cli", "Failed to write to stdin: {}", e);
                break;
            }
            if let Err(e) = stdin.flush().await {
                warn!(target: "claude-cli", "Failed to flush stdin: {}", e);
                break;
            }
        }
    });

    // Spawn stderr reader task
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim().to_string();
            if !trimmed.is_empty() {
                warn!(target: "claude-cli", "stderr: {}", trimmed);
            }
        }
    });

    // Spawn stdout reader + kill watcher task
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut yielded_any = false;

        tokio::pin!(kill_rx);

        loop {
            tokio::select! {
                // Check kill signal
                _ = &mut kill_rx => {
                    info!(target: "claude-cli", "Kill signal received, terminating child");
                    let _ = child.kill().await;
                    break;
                }
                // Read next line from stdout
                result = lines.next_line() => {
                    match result {
                        Ok(Some(line)) => {
                            let trimmed = line.trim().to_string();
                            if trimmed.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<CliEvent>(&trimmed) {
                                Ok(event) => {
                                    yielded_any = true;
                                    if events_tx.send(event).await.is_err() {
                                        // Receiver dropped, stop reading
                                        break;
                                    }
                                }
                                Err(_) => {
                                    warn!(
                                        target: "claude-cli",
                                        "Non-JSON line: {:.200}",
                                        trimmed
                                    );
                                }
                            }
                        }
                        Ok(None) => {
                            // EOF
                            break;
                        }
                        Err(e) => {
                            error!(target: "claude-cli", "Error reading stdout: {}", e);
                            break;
                        }
                    }
                }
            }
        }

        // Wait for the child process to exit
        match child.wait().await {
            Ok(status) => {
                let code = status.code().unwrap_or(-1);
                if code != 0 {
                    error!(
                        target: "claude-cli",
                        "Process exited with code {}", code
                    );
                }
            }
            Err(e) => {
                error!(target: "claude-cli", "Error waiting for child: {}", e);
            }
        }

        if !yielded_any {
            warn!(
                target: "claude-cli",
                "Process exited without producing any events"
            );
        }
    });

    Ok(SpawnClaudeResult {
        events_rx,
        kill_tx,
        stdin_tx,
    })
}
