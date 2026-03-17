use serde::{Deserialize, Serialize};

// ── Types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

// ── Commands ──────────────────────────────────────────────────

/// Open a project folder in VS Code.
#[tauri::command]
pub fn command_open_vscode(project_path: String) -> Result<(), String> {
    std::process::Command::new("code")
        .arg(&project_path)
        .spawn()
        .map_err(|e| format!("Failed to open VS Code: {}", e))?;
    Ok(())
}

/// Rebuild the project. This is a stub for the Tauri build since Electron's
/// `app.relaunch()` is not applicable here.
#[tauri::command]
pub fn command_rebuild(project_path: String) -> Result<(), String> {
    // In Tauri, "rebuild" does not apply the same way as Electron.
    // This is a no-op stub. A real implementation could trigger a cargo build
    // or restart the dev server.
    tracing::info!(
        target: "commands::shell",
        "Rebuild requested for {} (no-op in Tauri)", project_path
    );
    Ok(())
}

/// Run a build command in the project directory.
#[tauri::command]
pub async fn command_build(
    project_path: String,
    build_command: String,
) -> Result<BuildResult, String> {
    // Split the command into program + args
    let parts: Vec<&str> = build_command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty build command".to_string());
    }

    let program = parts[0];
    let args = &parts[1..];

    let output = tokio::process::Command::new(program)
        .args(args)
        .current_dir(&project_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run build command: {}", e))?;

    Ok(BuildResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
    })
}
