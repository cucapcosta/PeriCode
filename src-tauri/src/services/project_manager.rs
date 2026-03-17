use std::path::Path;

use rusqlite::Connection;
use tracing::{info, warn};

use crate::db::models::{Project, ProjectDetectionInfo, ProjectSettings};
use crate::db::queries::projects as project_queries;
use crate::error::{AppError, AppResult};

/// Add a project by its folder path.
///
/// Detects git information, reads CLAUDE.md / AGENTS.md config files,
/// and stores the project in the database. If the project already exists
/// (matched by resolved path) the existing record is returned instead.
pub fn add_project(conn: &Connection, folder_path: &str) -> AppResult<Project> {
    // Resolve to canonical path for dedup
    let canonical = std::fs::canonicalize(folder_path)
        .unwrap_or_else(|_| std::path::PathBuf::from(folder_path));
    let _canonical_str = canonical.to_string_lossy().to_string();

    // Check if project already exists
    let existing = project_queries::list_projects(conn).map_err(AppError::from)?;
    for proj in &existing {
        let proj_canonical = std::fs::canonicalize(&proj.path)
            .unwrap_or_else(|_| std::path::PathBuf::from(&proj.path));
        if proj_canonical == canonical {
            info!(
                target: "project-manager",
                "Project already exists: {}", folder_path
            );
            return Ok(proj.clone());
        }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let name = Path::new(folder_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| folder_path.to_string());

    let project = project_queries::add_project(conn, &id, &name, folder_path)
        .map_err(AppError::from)?;

    // Detect project info and apply any CLAUDE.md content as system prompt
    let info = detect_project_info(folder_path);
    if let Some(ref claude_content) = info.claude_md_content {
        let settings_update = ProjectSettings {
            system_prompt: Some(claude_content.clone()),
            ..Default::default()
        };
        let _ = project_queries::update_project_settings(conn, &id, &settings_update);
    }

    info!(
        target: "project-manager",
        "Added project: {} (git: {})", name, info.is_git_repo
    );

    // Re-fetch with any settings updates applied
    let updated = project_queries::get_project(conn, &id)
        .map_err(AppError::from)?
        .unwrap_or(project);

    Ok(updated)
}

/// Detect project characteristics: git repo, CLAUDE.md, AGENTS.md, default branch.
pub fn detect_project_info(project_path: &str) -> ProjectDetectionInfo {
    let mut info = ProjectDetectionInfo {
        is_git_repo: false,
        has_claude_md: false,
        has_agents_md: false,
        claude_md_content: None,
        agents_md_content: None,
        default_branch: None,
    };

    let base = Path::new(project_path);

    // Check for .git directory or file (worktree uses a .git file)
    let git_path = base.join(".git");
    info.is_git_repo = git_path.exists();

    // Read default branch from HEAD if git repo
    if info.is_git_repo {
        let head_path = if git_path.is_dir() {
            git_path.join("HEAD")
        } else {
            // .git file (worktree) — skip HEAD detection for simplicity
            std::path::PathBuf::new()
        };

        if head_path.exists() {
            if let Ok(head_content) = std::fs::read_to_string(&head_path) {
                let head_trimmed = head_content.trim();
                if let Some(branch) = head_trimmed.strip_prefix("ref: refs/heads/") {
                    info.default_branch = Some(branch.to_string());
                }
            }
        }
    }

    // Check for CLAUDE.md
    let claude_md_path = base.join("CLAUDE.md");
    if claude_md_path.exists() {
        info.has_claude_md = true;
        match std::fs::read_to_string(&claude_md_path) {
            Ok(content) => info.claude_md_content = Some(content),
            Err(e) => {
                warn!(
                    target: "project-manager",
                    "Failed to read CLAUDE.md: {}", e
                );
            }
        }
    }

    // Check for AGENTS.md
    let agents_md_path = base.join("AGENTS.md");
    if agents_md_path.exists() {
        info.has_agents_md = true;
        match std::fs::read_to_string(&agents_md_path) {
            Ok(content) => info.agents_md_content = Some(content),
            Err(e) => {
                warn!(
                    target: "project-manager",
                    "Failed to read AGENTS.md: {}", e
                );
            }
        }
    }

    info
}

/// Update the last_opened_at timestamp for a project.
pub fn touch_project(conn: &Connection, project_id: &str) -> AppResult<()> {
    project_queries::touch_project(conn, project_id).map_err(AppError::from)?;
    Ok(())
}

/// Get projects sorted by most recently opened, limited to `limit` results.
pub fn get_recent_projects(conn: &Connection, limit: usize) -> AppResult<Vec<Project>> {
    let mut projects = project_queries::list_projects(conn).map_err(AppError::from)?;

    projects.sort_by(|a, b| {
        let a_time = a
            .last_opened_at
            .as_deref()
            .unwrap_or(&a.created_at);
        let b_time = b
            .last_opened_at
            .as_deref()
            .unwrap_or(&b.created_at);
        // Reverse sort: most recent first
        b_time.cmp(a_time)
    });

    projects.truncate(limit);
    Ok(projects)
}
