use crate::db::models::FileDiff;
use crate::db::queries::{projects as project_queries, threads as thread_queries};
use crate::services::worktree_manager;
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// Get the diff of all changes in a thread's worktree.
#[tauri::command]
pub async fn worktree_get_diff(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<Vec<FileDiff>, String> {
    let worktree_path = resolve_worktree_path(&state, &thread_id)?;
    worktree_manager::get_diff(&worktree_path)
        .await
        .map_err(|e| e.to_string())
}

/// Accept all changes from a thread's worktree (merge back to main branch).
#[tauri::command]
pub async fn worktree_accept_all(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<(), String> {
    let (worktree_path, repo_path, default_branch) =
        resolve_worktree_and_repo(&state, &thread_id)?;

    worktree_manager::sync_back(
        &repo_path,
        &worktree_path,
        &default_branch,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Clean up the worktree after merge
    worktree_manager::destroy(&repo_path, &worktree_path)
        .await
        .map_err(|e| e.to_string())?;

    // Clear worktree info on the thread
    let db = state.db.lock();
    thread_queries::update_thread_worktree(&db, &thread_id, None, None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Accept a single file from a thread's worktree by cherry-picking its contents.
#[tauri::command]
pub async fn worktree_accept_file(
    state: tauri::State<'_, AppState>,
    thread_id: String,
    file_path: String,
) -> Result<(), String> {
    let (worktree_path, repo_path, _) = resolve_worktree_and_repo(&state, &thread_id)?;

    let src = std::path::Path::new(&worktree_path).join(&file_path);
    let dst = std::path::Path::new(&repo_path).join(&file_path);

    // Ensure the destination directory exists
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Copy the file from worktree to main repo
    tokio::fs::copy(&src, &dst)
        .await
        .map_err(|e| format!("Failed to copy file {}: {}", file_path, e))?;

    Ok(())
}

/// Reject all worktree changes (destroy the worktree without merging).
#[tauri::command]
pub async fn worktree_reject(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<(), String> {
    let (worktree_path, repo_path, _) = resolve_worktree_and_repo(&state, &thread_id)?;

    worktree_manager::destroy(&repo_path, &worktree_path)
        .await
        .map_err(|e| e.to_string())?;

    // Clear worktree info on the thread
    let db = state.db.lock();
    thread_queries::update_thread_worktree(&db, &thread_id, None, None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Open a file from a thread's worktree in the system default editor.
#[tauri::command]
pub fn worktree_open_in_editor(
    state: tauri::State<'_, AppState>,
    thread_id: String,
    file_path: String,
) -> Result<(), String> {
    let worktree_path = resolve_worktree_path(&state, &thread_id)?;
    let full_path = std::path::Path::new(&worktree_path).join(&file_path);

    // Use xdg-open / open / start depending on platform
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open")
        .arg(full_path.to_string_lossy().as_ref())
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg(full_path.to_string_lossy().as_ref())
        .spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", &full_path.to_string_lossy()])
        .spawn();

    result.map_err(|e| format!("Failed to open file: {}", e))?;

    Ok(())
}

/// Open a file or project in VS Code.
///
/// `file_path` is the file or project directory.
/// `line_or_project_path` can optionally be:
///   - A string project path (to use `--folder-uri`)
///   - A number line to jump to (combined with `line` param)
/// `line` is the optional line number for `--goto`.
#[tauri::command]
pub fn worktree_open_in_vscode(
    file_path: String,
    line_or_project_path: Option<serde_json::Value>,
    line: Option<u32>,
) -> Result<(), String> {
    let mut args: Vec<String> = Vec::new();

    // If a project path string is provided, add --folder-uri
    if let Some(serde_json::Value::String(ref project_path)) = line_or_project_path {
        args.push("--folder-uri".to_string());
        args.push(project_path.clone());
    }

    // Build goto target if line number is specified
    let goto_line = line.or_else(|| {
        line_or_project_path
            .as_ref()
            .and_then(|v| v.as_u64())
            .map(|n| n as u32)
    });

    if let Some(ln) = goto_line {
        args.push("--goto".to_string());
        args.push(format!("{}:{}", file_path, ln));
    } else {
        args.push(file_path);
    }

    std::process::Command::new("code")
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to open VS Code: {}", e))?;

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────

/// Resolve the worktree path for a thread, falling back to the project path.
fn resolve_worktree_path(state: &AppState, thread_id: &str) -> Result<String, String> {
    let db = state.db.lock();
    let thread = thread_queries::get_thread(&db, thread_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Thread not found: {}", thread_id))?;

    if let Some(ref wt_path) = thread.worktree_path {
        return Ok(wt_path.clone());
    }

    // Fall back to project path
    let project = project_queries::get_project(&db, &thread.project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Project not found: {}", thread.project_id))?;

    Ok(project.path)
}

/// Resolve the worktree path, the main repo path, and the default branch.
fn resolve_worktree_and_repo(
    state: &AppState,
    thread_id: &str,
) -> Result<(String, String, String), String> {
    let db = state.db.lock();
    let thread = thread_queries::get_thread(&db, thread_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Thread not found: {}", thread_id))?;

    let worktree_path = thread
        .worktree_path
        .clone()
        .ok_or_else(|| format!("Thread {} has no worktree", thread_id))?;

    let project = project_queries::get_project(&db, &thread.project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Project not found: {}", thread.project_id))?;

    // Determine default branch
    let default_branch = {
        let info = crate::services::project_manager::detect_project_info(&project.path);
        info.default_branch.unwrap_or_else(|| "main".to_string())
    };

    Ok((worktree_path, project.path, default_branch))
}
