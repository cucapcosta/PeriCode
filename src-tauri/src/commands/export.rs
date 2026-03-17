use tauri::AppHandle;

use crate::db::queries::threads as thread_queries;
use crate::services::{agent_orchestrator, export_service, worktree_manager};
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// Export a thread conversation as Markdown. Opens a save dialog.
#[tauri::command]
pub async fn export_thread_markdown(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<Option<String>, String> {
    let markdown = {
        let db = state.db.lock();
        export_service::export_thread_as_markdown(&db, &thread_id).map_err(|e| e.to_string())?
    };

    let save_path = show_save_dialog(
        &app_handle,
        "Export Thread",
        "thread.md",
        &[("Markdown", &["md"])],
    );

    match save_path {
        Some(path) => {
            tokio::fs::write(&path, &markdown)
                .await
                .map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Export worktree diff as a patch file. Opens a save dialog.
#[tauri::command]
pub async fn export_diff_patch(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<Option<String>, String> {
    let worktree_path = {
        let db = state.db.lock();
        let thread = thread_queries::get_thread(&db, &thread_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Thread not found: {}", thread_id))?;
        thread
            .worktree_path
            .ok_or_else(|| format!("Thread {} has no worktree", thread_id))?
    };

    // Call worktree_manager::get_diff directly (async, no db needed)
    let diffs = worktree_manager::get_diff(&worktree_path)
        .await
        .map_err(|e| e.to_string())?;

    // Build patch string
    let mut patch = String::new();
    for diff in &diffs {
        patch.push_str(&format!("--- a/{}\n", diff.path));
        patch.push_str(&format!("+++ b/{}\n", diff.path));
        patch.push_str(&format!(
            "@@ Status: {} (+{}/-{}) @@\n",
            diff.status, diff.additions, diff.deletions
        ));
        if let (Some(ref old), Some(ref new)) = (&diff.old_content, &diff.new_content) {
            for line in old.lines() {
                patch.push_str(&format!("-{}\n", line));
            }
            for line in new.lines() {
                patch.push_str(&format!("+{}\n", line));
            }
        }
        patch.push('\n');
    }

    let save_path = show_save_dialog(
        &app_handle,
        "Export Diff",
        "changes.patch",
        &[("Patch", &["patch", "diff"])],
    );

    match save_path {
        Some(path) => {
            tokio::fs::write(&path, &patch)
                .await
                .map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Export automation run history as CSV. Opens a save dialog.
#[tauri::command]
pub async fn export_automation_csv(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Option<String>, String> {
    let csv = {
        let db = state.db.lock();
        export_service::export_automation_history_as_csv(&db, &project_id)
            .map_err(|e| e.to_string())?
    };

    let save_path = show_save_dialog(
        &app_handle,
        "Export Automations",
        "automations.csv",
        &[("CSV", &["csv"])],
    );

    match save_path {
        Some(path) => {
            tokio::fs::write(&path, &csv)
                .await
                .map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

/// Export a project cost report as Markdown. Opens a save dialog.
#[tauri::command]
pub async fn export_cost_report(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Option<String>, String> {
    let total_cost = agent_orchestrator::get_total_cost(&state);
    let project_cost = agent_orchestrator::get_project_cost(&state, &project_id);

    let markdown = {
        let db = state.db.lock();
        export_service::export_cost_report(&db, &project_id, total_cost, project_cost)
            .map_err(|e| e.to_string())?
    };

    let save_path = show_save_dialog(
        &app_handle,
        "Export Cost Report",
        "cost-report.md",
        &[("Markdown", &["md"])],
    );

    match save_path {
        Some(path) => {
            tokio::fs::write(&path, &markdown)
                .await
                .map_err(|e| format!("Failed to write file: {}", e))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

// ── Helpers ───────────────────────────────────────────────────

/// Show a native save-file dialog and return the selected path (or None if cancelled).
///
/// Uses `blocking_save_file` which is synchronous (must not be called from async
/// context holding non-Send guards). We call it outside of any db lock.
fn show_save_dialog(
    app_handle: &AppHandle,
    title: &str,
    default_name: &str,
    filters: &[(&str, &[&str])],
) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app_handle
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(default_name);

    for (name, exts) in filters {
        builder = builder.add_filter(*name, exts);
    }

    let result = builder.blocking_save_file();

    result.and_then(|f| f.as_path().map(|p| p.to_string_lossy().to_string()))
}
