use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::db::queries::projects as project_queries;
use crate::state::AppState;

// ── Result types ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub files_changed: i32,
    pub insertions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    pub renamed: Vec<String>,
    pub untracked: Vec<String>,
    pub staged: Vec<String>,
    pub conflicted: Vec<String>,
    pub is_clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub success: bool,
    pub message: String,
    pub commit_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullResult {
    pub success: bool,
    pub message: String,
    pub updated_files: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchResult {
    pub success: bool,
    pub message: String,
    pub branches: Vec<String>,
    pub current: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────

/// Resolve the project path from a project ID.
fn get_project_path(state: &AppState, project_id: &str) -> Result<String, String> {
    let db = state.db.lock();
    let project = project_queries::get_project(&db, project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Project not found: {}", project_id))?;
    Ok(project.path)
}

/// Run a git command in the given directory and return (stdout, stderr, success).
fn run_git(cwd: &str, args: &[&str]) -> (String, String, bool) {
    match Command::new("git").args(args).current_dir(cwd).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            (stdout, stderr, output.status.success())
        }
        Err(e) => (String::new(), e.to_string(), false),
    }
}

// ── Commands ──────────────────────────────────────────────────

/// Get the current git branch for a project.
#[tauri::command]
pub fn git_get_current_branch(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Option<String>, String> {
    let path = get_project_path(&state, &project_id)?;
    let (stdout, _, success) = run_git(&path, &["rev-parse", "--abbrev-ref", "HEAD"]);
    if success && !stdout.is_empty() {
        Ok(Some(stdout))
    } else {
        Ok(None)
    }
}

/// Get diff statistics for uncommitted changes.
#[tauri::command]
pub fn git_get_diff_stats(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Option<DiffStats>, String> {
    let path = get_project_path(&state, &project_id)?;
    let (stdout, _, success) = run_git(&path, &["diff", "--stat", "--numstat"]);

    if !success {
        return Ok(None);
    }

    let mut files_changed = 0i32;
    let mut insertions = 0i32;
    let mut deletions = 0i32;

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            insertions += parts[0].parse::<i32>().unwrap_or(0);
            deletions += parts[1].parse::<i32>().unwrap_or(0);
            files_changed += 1;
        }
    }

    Ok(Some(DiffStats {
        files_changed,
        insertions,
        deletions,
    }))
}

/// Get the full git status for a project.
#[tauri::command]
pub fn git_status(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Option<GitStatusResult>, String> {
    let path = get_project_path(&state, &project_id)?;
    let (stdout, _, success) = run_git(&path, &["status", "--porcelain=v1"]);

    if !success {
        return Ok(None);
    }

    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();
    let mut renamed = Vec::new();
    let mut untracked = Vec::new();
    let mut staged = Vec::new();
    let mut conflicted = Vec::new();

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let index_status = line.as_bytes()[0] as char;
        let worktree_status = line.as_bytes()[1] as char;
        let file_path = line[3..].to_string();

        if index_status != ' ' && index_status != '?' {
            staged.push(file_path.clone());
        }

        match (index_status, worktree_status) {
            ('?', '?') => untracked.push(file_path),
            ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D') => conflicted.push(file_path),
            ('R', _) => renamed.push(file_path),
            ('A', _) | (_, 'A') => added.push(file_path),
            ('D', _) | (_, 'D') => deleted.push(file_path),
            ('M', _) | (_, 'M') => modified.push(file_path),
            _ => {}
        }
    }

    let is_clean = modified.is_empty()
        && added.is_empty()
        && deleted.is_empty()
        && renamed.is_empty()
        && untracked.is_empty()
        && staged.is_empty()
        && conflicted.is_empty();

    Ok(Some(GitStatusResult {
        modified,
        added,
        deleted,
        renamed,
        untracked,
        staged,
        conflicted,
        is_clean,
    }))
}

/// Stage files for commit.
#[tauri::command]
pub fn git_add(
    state: tauri::State<'_, AppState>,
    project_id: String,
    files: Vec<String>,
) -> Result<GitResult, String> {
    let path = get_project_path(&state, &project_id)?;

    let mut args = vec!["add"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);

    let (stdout, stderr, success) = run_git(&path, &args);

    Ok(GitResult {
        success,
        message: if success { stdout } else { stderr },
    })
}

/// Create a git commit with the given message.
#[tauri::command]
pub fn git_commit(
    state: tauri::State<'_, AppState>,
    project_id: String,
    message: String,
) -> Result<GitCommitResult, String> {
    let path = get_project_path(&state, &project_id)?;
    let (stdout, stderr, success) = run_git(&path, &["commit", "-m", &message]);

    let commit_hash = if success {
        // Parse the commit hash from output like "[branch abc1234] message"
        stdout
            .split_whitespace()
            .find(|s| s.len() >= 7 && s.ends_with(']'))
            .map(|s| s.trim_end_matches(']').to_string())
    } else {
        None
    };

    Ok(GitCommitResult {
        success,
        message: if success { stdout } else { stderr },
        commit_hash,
    })
}

/// Push to a remote.
#[tauri::command]
pub fn git_push(
    state: tauri::State<'_, AppState>,
    project_id: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<GitResult, String> {
    let path = get_project_path(&state, &project_id)?;

    let mut args = vec!["push"];
    let remote_str = remote.unwrap_or_else(|| "origin".to_string());
    args.push(&remote_str);
    let branch_owned;
    if let Some(ref b) = branch {
        branch_owned = b.clone();
        args.push(&branch_owned);
    }

    let (stdout, stderr, success) = run_git(&path, &args);

    Ok(GitResult {
        success,
        message: if success {
            if stdout.is_empty() { stderr.clone() } else { stdout }
        } else {
            stderr
        },
    })
}

/// Pull from a remote.
#[tauri::command]
pub fn git_pull(
    state: tauri::State<'_, AppState>,
    project_id: String,
    remote: Option<String>,
    branch: Option<String>,
) -> Result<GitPullResult, String> {
    let path = get_project_path(&state, &project_id)?;

    let mut args = vec!["pull"];
    let remote_str = remote.unwrap_or_else(|| "origin".to_string());
    args.push(&remote_str);
    let branch_owned;
    if let Some(ref b) = branch {
        branch_owned = b.clone();
        args.push(&branch_owned);
    }

    let (stdout, stderr, success) = run_git(&path, &args);

    // Try to count updated files from the output
    let updated_files = stdout
        .lines()
        .filter(|l| l.contains('|') || l.starts_with(" create") || l.starts_with(" delete"))
        .count() as i32;

    Ok(GitPullResult {
        success,
        message: if success { stdout } else { stderr },
        updated_files,
    })
}

/// Checkout a branch or create a new branch.
#[tauri::command]
pub fn git_checkout(
    state: tauri::State<'_, AppState>,
    project_id: String,
    branch_or_path: String,
    create_new: Option<bool>,
) -> Result<GitResult, String> {
    let path = get_project_path(&state, &project_id)?;

    let args = if create_new.unwrap_or(false) {
        vec!["checkout", "-b", &branch_or_path]
    } else {
        vec!["checkout", &branch_or_path]
    };

    let (stdout, stderr, success) = run_git(&path, &args);

    Ok(GitResult {
        success,
        message: if success {
            if stdout.is_empty() { stderr.clone() } else { stdout }
        } else {
            stderr
        },
    })
}

/// Branch operations: list, create, delete, rename.
///
/// `action` can be: "list", "create", "delete", "rename", "current".
#[tauri::command]
pub fn git_branch(
    state: tauri::State<'_, AppState>,
    project_id: String,
    action: String,
    branch_name: Option<String>,
) -> Result<GitBranchResult, String> {
    let path = get_project_path(&state, &project_id)?;

    match action.as_str() {
        "list" => {
            let (stdout, stderr, success) = run_git(&path, &["branch", "--list"]);
            let branches: Vec<String> = stdout
                .lines()
                .map(|l| l.trim().trim_start_matches("* ").to_string())
                .filter(|l| !l.is_empty())
                .collect();
            let current = stdout
                .lines()
                .find(|l| l.starts_with("* "))
                .map(|l| l.trim_start_matches("* ").to_string());

            Ok(GitBranchResult {
                success,
                message: if success { String::new() } else { stderr },
                branches,
                current,
            })
        }
        "create" => {
            let name = branch_name.ok_or("Branch name required for create")?;
            let (stdout, stderr, success) = run_git(&path, &["branch", &name]);
            Ok(GitBranchResult {
                success,
                message: if success { stdout } else { stderr },
                branches: Vec::new(),
                current: None,
            })
        }
        "delete" => {
            let name = branch_name.ok_or("Branch name required for delete")?;
            let (stdout, stderr, success) = run_git(&path, &["branch", "-d", &name]);
            Ok(GitBranchResult {
                success,
                message: if success { stdout } else { stderr },
                branches: Vec::new(),
                current: None,
            })
        }
        "current" => {
            let (stdout, _, success) =
                run_git(&path, &["rev-parse", "--abbrev-ref", "HEAD"]);
            Ok(GitBranchResult {
                success,
                message: String::new(),
                branches: Vec::new(),
                current: if success { Some(stdout) } else { None },
            })
        }
        _ => Err(format!("Unknown branch action: {}", action)),
    }
}

