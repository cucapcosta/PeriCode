use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;
use tracing::{info, warn};

use crate::db::models::{FileDiff, GitStatus, WorktreeInfo};
use crate::error::{AppError, AppResult};
use crate::utils::paths::get_worktree_base_path;

/// Create a new git worktree for an agent thread.
///
/// Branch naming convention: `pericode/<short-thread-id>/<short-description>`
pub async fn create(
    repo_path: &str,
    thread_id: &str,
    description: Option<&str>,
) -> AppResult<WorktreeInfo> {
    let base_path = get_worktree_base_path(repo_path);
    tokio::fs::create_dir_all(&base_path).await.map_err(AppError::Io)?;

    let short_id = &thread_id[..8.min(thread_id.len())];
    let short_desc = description
        .map(|d| {
            d.to_lowercase()
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { '-' })
                .collect::<String>()
                .chars()
                .take(30)
                .collect::<String>()
        })
        .unwrap_or_else(|| "work".to_string());

    let branch_name = format!("pericode/{}/{}", short_id, short_desc);
    let worktree_path = base_path.join(short_id);

    // Get current HEAD commit hash
    let head_output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let commit_hash = String::from_utf8_lossy(&head_output.stdout)
        .trim()
        .to_string();

    // Create the worktree with a new branch from current HEAD
    let worktree_path_str = worktree_path.to_string_lossy().to_string();
    let output = Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            &branch_name,
            &worktree_path_str,
            "HEAD",
        ])
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Other(format!(
            "Failed to create worktree: {}",
            stderr
        )));
    }

    info!(
        target: "worktree-manager",
        "Created worktree at {} on branch {}", worktree_path_str, branch_name
    );

    Ok(WorktreeInfo {
        path: worktree_path_str,
        branch: branch_name,
        commit_hash,
        is_main: false,
    })
}

/// Destroy a worktree and clean up its branch.
pub async fn destroy(repo_path: &str, worktree_path: &str) -> AppResult<()> {
    // Get the branch name before removing
    let worktrees = list(repo_path).await?;
    let resolved_wt = std::fs::canonicalize(worktree_path)
        .unwrap_or_else(|_| PathBuf::from(worktree_path));

    let branch_to_delete = worktrees
        .iter()
        .find(|w| {
            let resolved_w = std::fs::canonicalize(&w.path)
                .unwrap_or_else(|_| PathBuf::from(&w.path));
            resolved_w == resolved_wt
        })
        .map(|w| w.branch.clone());

    // Remove the worktree (force to handle dirty state)
    let output = Command::new("git")
        .args(["worktree", "remove", worktree_path, "--force"])
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(target: "worktree-manager", "Failed to remove worktree: {}", stderr);
    }

    // Delete the branch if it was a pericode branch
    if let Some(branch) = branch_to_delete {
        if branch.starts_with("pericode/") {
            let delete_output = Command::new("git")
                .args(["branch", "-D", &branch])
                .current_dir(repo_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await;

            match delete_output {
                Ok(out) if out.status.success() => {
                    info!(target: "worktree-manager", "Deleted branch {}", branch);
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    warn!(target: "worktree-manager", "Failed to delete branch {}: {}", branch, stderr);
                }
                Err(e) => {
                    warn!(target: "worktree-manager", "Failed to delete branch {}: {}", branch, e);
                }
            }
        }
    }

    info!(target: "worktree-manager", "Destroyed worktree at {}", worktree_path);
    Ok(())
}

/// List all worktrees for a repository using porcelain format.
pub async fn list(repo_path: &str) -> AppResult<Vec<WorktreeInfo>> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();

    // Parse porcelain output: blocks separated by double newlines
    for block in raw.trim().split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        let mut wt_path = String::new();
        let mut branch = String::new();
        let mut commit_hash = String::new();
        let mut is_bare = false;

        for line in block.lines() {
            if let Some(rest) = line.strip_prefix("worktree ") {
                wt_path = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("HEAD ") {
                commit_hash = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("branch ") {
                branch = rest.replace("refs/heads/", "");
            } else if line == "bare" {
                is_bare = true;
            }
        }

        // The first worktree is the main one
        let is_main =
            (worktrees.is_empty() && !branch.starts_with("pericode/")) || is_bare;

        if !wt_path.is_empty() {
            worktrees.push(WorktreeInfo {
                path: wt_path,
                branch,
                commit_hash,
                is_main,
            });
        }
    }

    Ok(worktrees)
}

/// Get the diff of all changes in a worktree compared to its base.
pub async fn get_diff(worktree_path: &str) -> AppResult<Vec<FileDiff>> {
    // Try diff against HEAD~1, fall back to --cached for initial commits
    let output = Command::new("git")
        .args(["diff", "--numstat", "HEAD~1"])
        .current_dir(worktree_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let raw = if output.status.success() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        // Fallback: diff against empty tree (cached)
        let fallback = Command::new("git")
            .args(["diff", "--numstat", "--cached"])
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(AppError::Io)?;
        String::from_utf8_lossy(&fallback.stdout).to_string()
    };

    let mut diffs = Vec::new();

    for line in raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }

        let additions: i32 = parts[0].parse().unwrap_or(0);
        let deletions: i32 = parts[1].parse().unwrap_or(0);
        let file_path = parts[2].to_string();

        let status = if additions > 0 && deletions == 0 {
            "added"
        } else if additions == 0 && deletions > 0 {
            "deleted"
        } else {
            "modified"
        };

        diffs.push(FileDiff {
            path: file_path,
            status: status.to_string(),
            additions,
            deletions,
            old_content: None,
            new_content: None,
        });
    }

    Ok(diffs)
}

/// Sync changes from a worktree branch back to a target branch.
///
/// Commits any uncommitted changes in the worktree, then merges the
/// worktree branch into the target branch on the main repository.
pub async fn sync_back(
    repo_path: &str,
    worktree_path: &str,
    _target_branch: &str,
) -> AppResult<()> {
    // Check if there are uncommitted changes and commit them
    let status_output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let status_text = String::from_utf8_lossy(&status_output.stdout);
    if !status_text.trim().is_empty() {
        // Stage all changes
        Command::new("git")
            .args(["add", "-A"])
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(AppError::Io)?;

        // Commit
        Command::new("git")
            .args(["commit", "-m", "PeriCode agent changes"])
            .current_dir(worktree_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(AppError::Io)?;
    }

    // Get the worktree branch name
    let branch_output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(worktree_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let current_branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // Merge the worktree branch into the target in the main repo
    let merge_msg = format!(
        "Merge PeriCode agent work from {}",
        current_branch
    );
    let merge_output = Command::new("git")
        .args(["merge", &current_branch, "--no-ff", "-m", &merge_msg])
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    if !merge_output.status.success() {
        let stderr = String::from_utf8_lossy(&merge_output.stderr);
        return Err(AppError::Other(format!(
            "Merge failed: {}",
            stderr
        )));
    }

    info!(
        target: "worktree-manager",
        "Synced {} back to main repo", current_branch
    );

    Ok(())
}

/// Get the git status of a worktree.
pub async fn get_status(worktree_path: &str) -> AppResult<GitStatus> {
    let output = Command::new("git")
        .args(["status", "--porcelain=v1"])
        .current_dir(worktree_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    let raw = String::from_utf8_lossy(&output.stdout);

    let mut modified = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();
    let mut renamed = Vec::new();
    let mut untracked = Vec::new();
    let mut staged = Vec::new();
    let mut conflicted = Vec::new();

    for line in raw.lines() {
        if line.len() < 3 {
            continue;
        }

        let index_status = line.as_bytes()[0] as char;
        let worktree_status = line.as_bytes()[1] as char;
        let file_path = line[3..].to_string();

        // Track staged files
        if index_status != ' ' && index_status != '?' {
            staged.push(file_path.clone());
        }

        // Classify by status
        match (index_status, worktree_status) {
            ('?', '?') => untracked.push(file_path),
            ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D') => {
                conflicted.push(file_path)
            }
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

    Ok(GitStatus {
        modified,
        added,
        deleted,
        renamed,
        untracked,
        staged,
        conflicted,
        is_clean,
    })
}

/// Prune orphaned worktrees (e.g., from app crashes).
pub async fn cleanup_orphaned(repo_path: &str) -> AppResult<()> {
    let output = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(AppError::Io)?;

    if output.status.success() {
        info!(target: "worktree-manager", "Pruned orphaned worktrees");
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(target: "worktree-manager", "Failed to prune worktrees: {}", stderr);
    }

    Ok(())
}
