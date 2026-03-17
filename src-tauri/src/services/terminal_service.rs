use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

use crate::error::{AppError, AppResult};
use crate::state::{AppState, TerminalSession};

// ── Public API ─────────────────────────────────────────────

/// Create a new terminal session using a real PTY via `portable-pty`.
///
/// Spawns the user's default shell, streams output to the frontend via
/// Tauri events (`terminal:data`, `terminal:exit`), and accepts input
/// through the `write()` function.
pub fn create(
    app_handle: &AppHandle,
    state: &AppState,
    id: &str,
    cwd: &str,
) -> AppResult<()> {
    // Destroy any existing session with this ID
    destroy(state, id);

    let pty_system = native_pty_system();

    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Other(format!("Failed to open PTY: {}", e)))?;

    // Determine shell
    let shell = if cfg!(target_os = "windows") {
        "cmd.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    };

    let mut cmd = CommandBuilder::new(&shell);
    if cfg!(target_os = "windows") {
        cmd.arg("/k");
    } else {
        cmd.arg("-i");
    }
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let _child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| AppError::Other(format!("Failed to spawn shell: {}", e)))?;

    // Get a writer for stdin
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| AppError::Other(format!("Failed to get PTY writer: {}", e)))?;

    // Get a reader for stdout
    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Other(format!("Failed to get PTY reader: {}", e)))?;

    // Set up channels for stdin writes and kill signals
    let (stdin_tx, stdin_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    let (kill_tx, _kill_rx) = std::sync::mpsc::channel::<()>();

    // Store the session
    {
        let mut terminals = state.terminals.lock();
        terminals.insert(
            id.to_string(),
            TerminalSession {
                id: id.to_string(),
                cwd: cwd.to_string(),
                stdin_tx: Some(stdin_tx),
                kill_tx: Some(kill_tx),
            },
        );
    }

    // Spawn stdin writer thread
    let mut writer = writer;
    std::thread::spawn(move || {
        use std::io::Write;
        while let Ok(data) = stdin_rx.recv() {
            if let Err(e) = writer.write_all(&data) {
                warn!(target: "terminal-service", "Failed to write to PTY: {}", e);
                break;
            }
            if let Err(e) = writer.flush() {
                warn!(target: "terminal-service", "Failed to flush PTY: {}", e);
                break;
            }
        }
    });

    // Spawn stdout reader thread
    let terminal_id = id.to_string();
    let app_handle_clone = app_handle.clone();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle_clone.emit(
                        &format!("terminal:data:{}", terminal_id),
                        &data,
                    );
                }
                Err(e) => {
                    if e.kind() == std::io::ErrorKind::BrokenPipe
                        || e.kind() == std::io::ErrorKind::UnexpectedEof
                    {
                        break;
                    }
                    error!(target: "terminal-service", "PTY read error: {}", e);
                    break;
                }
            }
        }

        // Notify exit
        let _ = app_handle_clone.emit(
            &format!("terminal:exit:{}", terminal_id),
            "0",
        );
    });

    info!(target: "terminal-service", "Created terminal {} in {}", id, cwd);
    Ok(())
}

/// Write input data to a terminal session.
pub fn write(state: &AppState, id: &str, data: &[u8]) -> AppResult<()> {
    let terminals = state.terminals.lock();
    let session = terminals
        .get(id)
        .ok_or_else(|| AppError::NotFound(format!("Terminal not found: {}", id)))?;

    if let Some(ref tx) = session.stdin_tx {
        let _ = tx.send(data.to_vec());
    }

    Ok(())
}

/// Resize a terminal session.
pub fn resize(state: &AppState, id: &str, _cols: u16, _rows: u16) -> AppResult<()> {
    let terminals = state.terminals.lock();
    if !terminals.contains_key(id) {
        return Err(AppError::NotFound(format!("Terminal not found: {}", id)));
    }
    // TODO: store master handle for resize support
    Ok(())
}

/// Destroy a terminal session.
pub fn destroy(state: &AppState, id: &str) {
    let mut terminals = state.terminals.lock();
    if let Some(mut session) = terminals.remove(id) {
        // Drop the stdin sender to close the write end
        session.stdin_tx.take();

        // Send kill signal
        if let Some(tx) = session.kill_tx.take() {
            let _ = tx.send(());
        }

        info!(target: "terminal-service", "Destroyed terminal {}", id);
    }
}

/// Get all active terminal session IDs.
pub fn get_active_ids(state: &AppState) -> Vec<String> {
    let terminals = state.terminals.lock();
    terminals.keys().cloned().collect()
}

/// Clean up all terminal sessions.
pub fn shutdown(state: &AppState) {
    let mut terminals = state.terminals.lock();
    let ids: Vec<String> = terminals.keys().cloned().collect();
    for id in &ids {
        if let Some(mut session) = terminals.remove(id) {
            session.stdin_tx.take();
            if let Some(tx) = session.kill_tx.take() {
                let _ = tx.send(());
            }
        }
    }
    info!(target: "terminal-service", "All terminals shut down");
}
