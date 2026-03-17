use anyhow::Result;
use tokio::process::Command;

/// Default timeout: 2 minutes.
const DEFAULT_TIMEOUT_MS: u64 = 120_000;

/// Result of executing a bash command.
pub struct BashResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Execute a shell command asynchronously.
///
/// * `command` - The shell command string to execute.
/// * `cwd` - Current working directory for the command.
/// * `timeout` - Optional timeout in milliseconds (default: 120000).
///
/// Returns `BashResult` with exit code, stdout, and stderr.
pub async fn bash_tool(
    command: &str,
    cwd: &str,
    timeout: Option<u64>,
) -> Result<BashResult> {
    let timeout_ms = timeout.unwrap_or(DEFAULT_TIMEOUT_MS);

    let child = Command::new("/bin/bash")
        .arg("-c")
        .arg(command)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()?;

    let result = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        child.wait_with_output(),
    )
    .await;

    match result {
        Ok(Ok(output)) => Ok(BashResult {
            exit_code: output.status.code().unwrap_or(1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        }),
        Ok(Err(e)) => {
            anyhow::bail!("Command execution error: {}", e);
        }
        Err(_) => {
            // kill_on_drop will handle cleanup when child is dropped
            anyhow::bail!("Command timed out after {}ms", timeout_ms);
        }
    }
}
