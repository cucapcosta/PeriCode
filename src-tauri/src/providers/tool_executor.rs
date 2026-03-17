use serde_json::Value;
use tracing::{error, warn};

use super::tools;
use super::types::PermissionMode;

// ── Types ────────────────────────────────────────────────────

pub struct ToolExecutionResult {
    pub output: String,
    pub success: bool,
    pub requires_permission: bool,
}

/// Tool definition for API registration (sent to Copilot).
pub struct ToolDefinitionEntry {
    pub name: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
}

// Tools that modify files or system state.
const WRITE_TOOLS: &[&str] = &["Write", "Edit", "Bash"];

// ── Permission Check ─────────────────────────────────────────

fn requires_permission(tool_name: &str, permission_mode: &PermissionMode) -> bool {
    match permission_mode {
        PermissionMode::Full => false,
        PermissionMode::AcceptEdits => tool_name == "Bash",
        PermissionMode::Ask => WRITE_TOOLS.contains(&tool_name),
    }
}

// ── Tool Executor ────────────────────────────────────────────

/// Execute a tool by name with the given JSON input. Returns the output string.
pub async fn execute_tool(
    tool_name: &str,
    tool_input: &Value,
    cwd: &str,
    permission_mode: &PermissionMode,
) -> ToolExecutionResult {
    let needs_permission = requires_permission(tool_name, permission_mode);

    if needs_permission && *permission_mode == PermissionMode::Ask {
        warn!("tool-executor: tool {} requires permission but IPC not implemented yet", tool_name);
    }

    match execute_tool_impl(tool_name, tool_input, cwd).await {
        Ok(output) => ToolExecutionResult {
            output,
            success: true,
            requires_permission: needs_permission,
        },
        Err(e) => {
            error!("tool-executor: tool {} failed: {}", tool_name, e);
            ToolExecutionResult {
                output: format!("Error: {}", e),
                success: false,
                requires_permission: needs_permission,
            }
        }
    }
}

/// Strip null values from tool input (strict-mode schemas send null for optional params).
fn strip_nulls(input: &Value) -> Value {
    match input {
        Value::Object(map) => {
            let filtered: serde_json::Map<String, Value> = map
                .iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            Value::Object(filtered)
        }
        other => other.clone(),
    }
}

async fn execute_tool_impl(
    tool_name: &str,
    raw_input: &Value,
    cwd: &str,
) -> anyhow::Result<String> {
    let input = strip_nulls(raw_input);

    match tool_name {
        "Read" => {
            let file_path = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing file_path"))?;
            let offset = input.get("offset").and_then(|v| v.as_u64()).map(|v| v as usize);
            let limit = input.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize);

            let result = tools::read::read_tool(file_path, cwd, offset, limit)?;
            Ok(result)
        }

        "Write" => {
            let file_path = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing file_path"))?;
            let content = input
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing content"))?;

            let bytes = tools::write::write_tool(file_path, content, cwd)?;
            Ok(format!("File written successfully ({} bytes)", bytes))
        }

        "Edit" => {
            let file_path = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing file_path"))?;
            let old_string = input
                .get("old_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing old_string"))?;
            let new_string = input
                .get("new_string")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing new_string"))?;
            let replace_all = input
                .get("replace_all")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let replacements = tools::edit::edit_tool(file_path, old_string, new_string, replace_all, cwd)?;
            Ok(format!("Replaced {} occurrence(s)", replacements))
        }

        "Bash" => {
            let command = input
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing command"))?;
            let timeout = input
                .get("timeout")
                .and_then(|v| v.as_u64())
                .map(|v| v as u64);

            let result = tools::bash::bash_tool(command, cwd, timeout).await?;
            let output = if result.stderr.is_empty() {
                result.stdout
            } else {
                format!("{}\nStderr: {}", result.stdout, result.stderr)
            };
            Ok(format!("Exit code: {}\n{}", result.exit_code, output))
        }

        "Glob" => {
            let pattern = input
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing pattern"))?;
            let path = input.get("path").and_then(|v| v.as_str());

            let files = tools::glob::glob_tool(pattern, path, cwd)?;
            if files.is_empty() {
                Ok("No files found".to_string())
            } else {
                Ok(files.join("\n"))
            }
        }

        "Grep" => {
            let pattern = input
                .get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Missing pattern"))?;
            let path = input.get("path").and_then(|v| v.as_str());
            let glob_filter = input.get("glob").and_then(|v| v.as_str());
            let context = input.get("context").and_then(|v| v.as_u64()).map(|v| v as usize);
            let output_mode = input
                .get("output_mode")
                .and_then(|v| v.as_str())
                .unwrap_or("files_with_matches");

            let result = tools::grep::grep_tool(pattern, path, glob_filter, context, output_mode, cwd)?;

            if result.matches.is_empty() {
                Ok("No matches found".to_string())
            } else {
                match output_mode {
                    "files_with_matches" => {
                        Ok(result.matches.iter().map(|m| m.file.as_str()).collect::<Vec<_>>().join("\n"))
                    }
                    "count" => {
                        Ok(format!("{} matches in {} files", result.match_count, result.file_count))
                    }
                    _ => {
                        // "content" mode
                        Ok(result
                            .matches
                            .iter()
                            .map(|m| format!("{}:{}: {}", m.file, m.line, m.content))
                            .collect::<Vec<_>>()
                            .join("\n"))
                    }
                }
            }
        }

        _ => anyhow::bail!("Unknown tool: {}", tool_name),
    }
}

// ── Tool Definitions ─────────────────────────────────────────

use serde_json::json;
use once_cell::sync::Lazy;

pub static TOOL_DEFINITIONS: Lazy<Vec<ToolDefinitionEntry>> = Lazy::new(|| {
    vec![
        ToolDefinitionEntry {
            name: "Read",
            description: "Read the contents of a file",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "The path to the file to read"},
                    "offset": {"type": "number", "description": "Line number to start reading from (0-indexed)"},
                    "limit": {"type": "number", "description": "Maximum number of lines to read"},
                },
                "required": ["file_path"],
            }),
        },
        ToolDefinitionEntry {
            name: "Write",
            description: "Write content to a file, creating it if it doesn't exist",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "The path to the file to write"},
                    "content": {"type": "string", "description": "The content to write to the file"},
                },
                "required": ["file_path", "content"],
            }),
        },
        ToolDefinitionEntry {
            name: "Edit",
            description: "Search and replace text in a file",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "The path to the file to edit"},
                    "old_string": {"type": "string", "description": "The text to search for"},
                    "new_string": {"type": "string", "description": "The text to replace with"},
                    "replace_all": {"type": "boolean", "description": "Replace all occurrences (default: false)"},
                },
                "required": ["file_path", "old_string", "new_string"],
            }),
        },
        ToolDefinitionEntry {
            name: "Bash",
            description: "Execute a shell command",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "The command to execute"},
                    "timeout": {"type": "number", "description": "Timeout in milliseconds (default: 120000)"},
                },
                "required": ["command"],
            }),
        },
        ToolDefinitionEntry {
            name: "Glob",
            description: "Find files matching a glob pattern",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "The glob pattern (e.g., '**/*.ts')"},
                    "path": {"type": "string", "description": "Base directory to search in"},
                },
                "required": ["pattern"],
            }),
        },
        ToolDefinitionEntry {
            name: "Grep",
            description: "Search for text in files using regex",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "The regex pattern to search for"},
                    "path": {"type": "string", "description": "File or directory to search in"},
                    "glob": {"type": "string", "description": "Glob pattern to filter files (e.g., '*.ts')"},
                    "context": {"type": "number", "description": "Number of context lines before and after match"},
                    "output_mode": {
                        "type": "string",
                        "enum": ["content", "files_with_matches", "count"],
                        "description": "Output mode (default: files_with_matches)",
                    },
                },
                "required": ["pattern"],
            }),
        },
    ]
});
