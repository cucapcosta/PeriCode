#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pericode::utils::logger::init_logger();

    let db_path = pericode::utils::paths::get_database_path();
    let _ = pericode::utils::paths::ensure_directories();

    let db_path_str = db_path.to_str().expect("Invalid database path");
    let conn = pericode::db::initialize(db_path_str).expect("Failed to initialize database");

    // Mark stale running threads from previous session
    {
        let _ = pericode::db::queries::threads::mark_stale_running_threads(&conn);
    }

    let state = pericode::state::AppState::new(conn);

    // Load historical costs from DB
    {
        let db = state.db.lock();
        let project_costs = pericode::db::queries::model_usage::get_all_project_costs(&db).unwrap_or_default();
        let model_usage = pericode::db::queries::model_usage::get_global_model_usage(&db).unwrap_or_default();
        let mut orch = state.orchestrator.write();
        orch.project_costs = project_costs;
        pericode::state::merge_model_usage(&mut orch.global_model_usage, &model_usage);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            // Projects
            pericode::commands::projects::project_list,
            pericode::commands::projects::project_add,
            pericode::commands::projects::project_remove,
            pericode::commands::projects::project_get_settings,
            pericode::commands::projects::project_update_settings,
            pericode::commands::projects::project_open_folder,
            pericode::commands::projects::project_detect_info,
            // Agents
            pericode::commands::agents::agent_launch,
            pericode::commands::agents::agent_pause,
            pericode::commands::agents::agent_resume,
            pericode::commands::agents::agent_cancel,
            pericode::commands::agents::agent_send_message,
            pericode::commands::agents::agent_respond_permission,
            pericode::commands::agents::agent_get_running,
            // Threads
            pericode::commands::threads::thread_list,
            pericode::commands::threads::thread_get,
            pericode::commands::threads::thread_get_messages,
            pericode::commands::threads::thread_delete,
            pericode::commands::threads::thread_fork,
            pericode::commands::threads::thread_get_cost_summary,
            pericode::commands::threads::thread_update_provider,
            // Notes
            pericode::commands::notes::notes_get,
            pericode::commands::notes::notes_save,
            pericode::commands::notes::notes_delete,
            // Worktrees
            pericode::commands::worktrees::worktree_get_diff,
            pericode::commands::worktrees::worktree_accept_all,
            pericode::commands::worktrees::worktree_accept_file,
            pericode::commands::worktrees::worktree_reject,
            pericode::commands::worktrees::worktree_open_in_editor,
            pericode::commands::worktrees::worktree_open_in_vscode,
            // Git
            pericode::commands::git::git_get_current_branch,
            pericode::commands::git::git_get_diff_stats,
            pericode::commands::git::git_status,
            pericode::commands::git::git_add,
            pericode::commands::git::git_commit,
            pericode::commands::git::git_push,
            pericode::commands::git::git_pull,
            pericode::commands::git::git_checkout,
            pericode::commands::git::git_branch,
            // Skills
            pericode::commands::skills::skill_list,
            pericode::commands::skills::skill_get,
            pericode::commands::skills::skill_create,
            pericode::commands::skills::skill_update,
            pericode::commands::skills::skill_delete,
            pericode::commands::skills::skill_export,
            pericode::commands::skills::skill_import,
            pericode::commands::skills::skill_import_from_git,
            // Automations
            pericode::commands::automations::automation_list,
            pericode::commands::automations::automation_create,
            pericode::commands::automations::automation_update,
            pericode::commands::automations::automation_delete,
            pericode::commands::automations::automation_trigger,
            pericode::commands::automations::automation_toggle_enabled,
            pericode::commands::automations::automation_get_history,
            pericode::commands::automations::automation_get_inbox,
            pericode::commands::automations::automation_mark_read,
            pericode::commands::automations::automation_archive_run,
            pericode::commands::automations::automation_get_templates,
            // Settings
            pericode::commands::settings::settings_get,
            pericode::commands::settings::settings_update,
            pericode::commands::settings::settings_get_cli_status,
            // Providers
            pericode::commands::providers::provider_list,
            pericode::commands::providers::provider_get_models,
            pericode::commands::providers::copilot_start_auth,
            pericode::commands::providers::copilot_poll_auth,
            pericode::commands::providers::copilot_check_auth,
            pericode::commands::providers::copilot_logout,
            // Status
            pericode::commands::status::status_get_info,
            pericode::commands::status::notification_get_history,
            pericode::commands::status::notification_clear,
            // Terminal
            pericode::commands::terminal::terminal_create,
            pericode::commands::terminal::terminal_write,
            pericode::commands::terminal::terminal_resize,
            pericode::commands::terminal::terminal_destroy,
            pericode::commands::terminal::terminal_list,
            // Export
            pericode::commands::export::export_thread_markdown,
            pericode::commands::export::export_diff_patch,
            pericode::commands::export::export_automation_csv,
            pericode::commands::export::export_cost_report,
            // Images
            pericode::commands::images::image_pick,
            pericode::commands::images::image_read_base64,
            pericode::commands::images::image_validate_path,
            pericode::commands::images::image_save_from_clipboard,
            pericode::commands::images::image_save_from_base64,
            // Shell Commands
            pericode::commands::shell_commands::command_open_vscode,
            pericode::commands::shell_commands::command_rebuild,
            pericode::commands::shell_commands::command_build,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PeriCode");
}
