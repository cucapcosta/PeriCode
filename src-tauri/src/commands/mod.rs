pub mod agents;
pub mod threads;
pub mod projects;
pub mod worktrees;
pub mod git;
pub mod skills;
pub mod automations;
pub mod settings;
pub mod terminal;
pub mod export;
pub mod images;
pub mod notes;
pub mod status;
pub mod providers;
pub mod shell_commands;

/// Collects all Tauri command handlers into a single `generate_handler!` invocation.
///
/// Call this from `lib.rs` when building the Tauri app:
/// ```ignore
/// tauri::Builder::default()
///     .invoke_handler(commands::generate_handler())
///     ...
/// ```
pub fn generate_handler() -> impl Fn(tauri::ipc::Invoke) -> bool {
    tauri::generate_handler![
        // ── Projects ──────────────────────────────────────────
        projects::project_list,
        projects::project_add,
        projects::project_remove,
        projects::project_get_settings,
        projects::project_update_settings,
        projects::project_open_folder,
        projects::project_detect_info,
        // ── Agents ────────────────────────────────────────────
        agents::agent_launch,
        agents::agent_pause,
        agents::agent_resume,
        agents::agent_cancel,
        agents::agent_send_message,
        agents::agent_respond_permission,
        agents::agent_get_running,
        // ── Threads ───────────────────────────────────────────
        threads::thread_list,
        threads::thread_get,
        threads::thread_get_messages,
        threads::thread_delete,
        threads::thread_fork,
        threads::thread_get_cost_summary,
        threads::thread_update_provider,
        // ── Worktrees ─────────────────────────────────────────
        worktrees::worktree_get_diff,
        worktrees::worktree_accept_all,
        worktrees::worktree_accept_file,
        worktrees::worktree_reject,
        worktrees::worktree_open_in_editor,
        worktrees::worktree_open_in_vscode,
        // ── Git ───────────────────────────────────────────────
        git::git_get_current_branch,
        git::git_get_diff_stats,
        git::git_status,
        git::git_add,
        git::git_commit,
        git::git_push,
        git::git_pull,
        git::git_checkout,
        git::git_branch,
        // ── Skills ────────────────────────────────────────────
        skills::skill_list,
        skills::skill_get,
        skills::skill_create,
        skills::skill_update,
        skills::skill_delete,
        skills::skill_export,
        skills::skill_import,
        skills::skill_import_from_git,
        // ── Automations ───────────────────────────────────────
        automations::automation_list,
        automations::automation_create,
        automations::automation_update,
        automations::automation_delete,
        automations::automation_trigger,
        automations::automation_toggle_enabled,
        automations::automation_get_history,
        automations::automation_get_inbox,
        automations::automation_mark_read,
        automations::automation_archive_run,
        automations::automation_get_templates,
        // ── Settings ──────────────────────────────────────────
        settings::settings_get,
        settings::settings_update,
        settings::settings_get_cli_status,
        // ── Terminal ──────────────────────────────────────────
        terminal::terminal_create,
        terminal::terminal_write,
        terminal::terminal_resize,
        terminal::terminal_destroy,
        terminal::terminal_list,
        // ── Export ────────────────────────────────────────────
        export::export_thread_markdown,
        export::export_diff_patch,
        export::export_automation_csv,
        export::export_cost_report,
        // ── Images ────────────────────────────────────────────
        images::image_pick,
        images::image_read_base64,
        images::image_validate_path,
        images::image_save_from_clipboard,
        images::image_save_from_base64,
        // ── Notes ─────────────────────────────────────────────
        notes::notes_get,
        notes::notes_save,
        notes::notes_delete,
        // ── Status ────────────────────────────────────────────
        status::status_get_info,
        status::notification_get_history,
        status::notification_clear,
        // ── Providers ─────────────────────────────────────────
        providers::provider_list,
        providers::provider_get_models,
        providers::copilot_start_auth,
        providers::copilot_poll_auth,
        providers::copilot_check_auth,
        providers::copilot_logout,
        // ── Shell Commands ────────────────────────────────────
        shell_commands::command_open_vscode,
        shell_commands::command_rebuild,
        shell_commands::command_build,
    ]
}
