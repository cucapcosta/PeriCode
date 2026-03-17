use rusqlite::Connection;

use crate::db::models::Message;
use crate::db::queries::{
    automations as auto_queries,
    messages as message_queries,
    projects as project_queries,
    threads as thread_queries,
};
use crate::error::{AppError, AppResult};

// ── Public API ─────────────────────────────────────────────

/// Export a thread conversation as Markdown.
///
/// Returns the Markdown string. The caller (Tauri command) is responsible
/// for presenting a save dialog and writing to disk.
pub fn export_thread_as_markdown(conn: &Connection, thread_id: &str) -> AppResult<String> {
    let thread = thread_queries::get_thread(conn, thread_id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound(format!("Thread not found: {}", thread_id)))?;

    let messages = message_queries::list_messages(conn, thread_id).map_err(AppError::from)?;

    let project = thread
        .project_id
        .as_str()
        .pipe(|pid| project_queries::get_project(conn, pid))
        .map_err(AppError::from)?;

    let project_name = project
        .as_ref()
        .map(|p| p.name.as_str())
        .unwrap_or("Unknown");

    let mut markdown = format!(
        "# Thread: {}\n\n",
        thread.title.as_deref().unwrap_or("Untitled")
    );
    markdown.push_str(&format!("- **Project**: {}\n", project_name));
    markdown.push_str(&format!("- **Status**: {}\n", thread.status));
    markdown.push_str(&format!("- **Created**: {}\n", thread.created_at));
    if let Some(ref branch) = thread.worktree_branch {
        markdown.push_str(&format!("- **Branch**: {}\n", branch));
    }
    markdown.push_str("\n---\n\n");

    for msg in &messages {
        markdown.push_str(&message_to_markdown(msg));
        markdown.push('\n');
    }

    Ok(markdown)
}

/// Export diff from a thread's worktree as a patch file.
///
/// Returns the patch string. The caller is responsible for saving to disk.
pub async fn export_diff_as_patch(
    _conn: &Connection,
    _thread_id: &str,
    worktree_path: &str,
) -> AppResult<String> {
    let diffs = super::worktree_manager::get_diff(worktree_path).await?;

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

    Ok(patch)
}

/// Export automation run history as CSV.
///
/// Returns the CSV string. The caller is responsible for saving to disk.
pub fn export_automation_history_as_csv(
    conn: &Connection,
    project_id: &str,
) -> AppResult<String> {
    let automations = auto_queries::list_automations(conn, project_id).map_err(AppError::from)?;

    let mut rows = vec![
        "automation_id,automation_name,run_id,status,started_at,finished_at".to_string(),
    ];

    for auto in &automations {
        let runs = auto_queries::list_automation_runs(conn, &auto.id).map_err(AppError::from)?;
        for run in &runs {
            let name_escaped = auto.name.replace('"', "\"\"");
            rows.push(format!(
                "{},\"{}\",{},{},{},{}",
                auto.id,
                name_escaped,
                run.id,
                run.status,
                run.started_at,
                run.finished_at.as_deref().unwrap_or("")
            ));
        }
    }

    Ok(rows.join("\n"))
}

/// Generate a project cost report as Markdown.
///
/// `total_cost` and `project_cost` are provided by the caller from the
/// in-memory orchestrator state since they are not purely DB-derived.
pub fn export_cost_report(
    conn: &Connection,
    project_id: &str,
    total_cost: f64,
    project_cost: f64,
) -> AppResult<String> {
    let project = project_queries::get_project(conn, project_id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;

    let threads = thread_queries::list_threads(conn, project_id).map_err(AppError::from)?;

    let mut markdown = format!("# Cost Report: {}\n\n", project.name);
    markdown.push_str(&format!(
        "- **Generated**: {}\n",
        chrono::Utc::now().to_rfc3339()
    ));
    markdown.push_str(&format!(
        "- **Total Session Cost**: ${:.4}\n",
        total_cost
    ));
    markdown.push_str(&format!(
        "- **Project Cost**: ${:.4}\n\n",
        project_cost
    ));

    markdown.push_str("## Thread Breakdown\n\n");
    markdown
        .push_str("| Thread | Status | Cost (USD) | Tokens In | Tokens Out |\n");
    markdown
        .push_str("|--------|--------|-----------|-----------|------------|\n");

    let mut grand_total_cost: f64 = 0.0;
    let mut grand_total_in: i64 = 0;
    let mut grand_total_out: i64 = 0;

    for thread in &threads {
        let messages = message_queries::list_messages(conn, &thread.id).map_err(AppError::from)?;

        let mut thread_cost: f64 = 0.0;
        let mut thread_in: i64 = 0;
        let mut thread_out: i64 = 0;

        for msg in &messages {
            if let Some(c) = msg.cost_usd {
                thread_cost += c;
            }
            if let Some(t) = msg.tokens_in {
                thread_in += t;
            }
            if let Some(t) = msg.tokens_out {
                thread_out += t;
            }
        }

        grand_total_cost += thread_cost;
        grand_total_in += thread_in;
        grand_total_out += thread_out;

        let title = thread
            .title
            .as_deref()
            .unwrap_or("Untitled")
            .chars()
            .take(40)
            .collect::<String>();

        markdown.push_str(&format!(
            "| {} | {} | ${:.4} | {} | {} |\n",
            title, thread.status, thread_cost, thread_in, thread_out
        ));
    }

    markdown.push_str(&format!(
        "| **Total** | | **${:.4}** | **{}** | **{}** |\n",
        grand_total_cost, grand_total_in, grand_total_out
    ));

    Ok(markdown)
}

// ── Internal helpers ───────────────────────────────────────

/// Format a single message for Markdown export.
fn message_to_markdown(msg: &Message) -> String {
    let role_label = match msg.role.as_str() {
        "user" => "User",
        "assistant" => "Assistant",
        "system" => "System",
        "tool_use" => "Tool Use",
        _ => "Tool Result",
    };

    let mut body = String::new();

    for block in &msg.content {
        match block.content_type.as_str() {
            "text" => {
                if let Some(ref text) = block.text {
                    body.push_str(text);
                    body.push('\n');
                }
            }
            "tool_use" => {
                if let Some(ref name) = block.tool_name {
                    body.push_str(&format!("`{}`", name));
                }
                if let Some(ref input) = block.tool_input {
                    body.push_str(&format!(
                        "\n```json\n{}\n```\n",
                        serde_json::to_string_pretty(input).unwrap_or_default()
                    ));
                }
            }
            "tool_result" => {
                if let Some(ref output) = block.tool_output {
                    body.push_str(&format!("```\n{}\n```\n", output));
                }
            }
            _ => {}
        }
    }

    let cost_line = msg
        .cost_usd
        .map(|c| format!(" | Cost: ${:.4}", c))
        .unwrap_or_default();
    let token_line = if msg.tokens_in.is_some() || msg.tokens_out.is_some() {
        format!(
            " | Tokens: {} in / {} out",
            msg.tokens_in.unwrap_or(0),
            msg.tokens_out.unwrap_or(0)
        )
    } else {
        String::new()
    };

    format!(
        "### {} ({}{}{})\n\n{}\n---\n",
        role_label, msg.created_at, cost_line, token_line, body
    )
}

/// Helper trait to pipe a value through a closure (like Kotlin's `let`).
trait Pipe: Sized {
    fn pipe<F, R>(self, f: F) -> R
    where
        F: FnOnce(Self) -> R,
    {
        f(self)
    }
}

impl<T> Pipe for T {}
