use crate::db::models::{
    Message, ProviderType, ThreadCostSummary, ThreadDetail, ThreadInfo,
};
use crate::db::queries::{
    messages as message_queries, model_usage as model_usage_queries,
    threads as thread_queries,
};
use crate::services::agent_orchestrator;
use crate::state::AppState;

// ── Commands ──────────────────────────────────────────────────

/// List all threads for a project.
#[tauri::command]
pub fn thread_list(
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> Result<Vec<ThreadInfo>, String> {
    let db = state.db.lock();
    thread_queries::list_threads(&db, &project_id).map_err(|e| e.to_string())
}

/// Get a single thread with its messages.
#[tauri::command]
pub fn thread_get(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadDetail, String> {
    let db = state.db.lock();
    let thread = thread_queries::get_thread(&db, &thread_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Thread not found: {}", thread_id))?;
    let messages = message_queries::list_messages(&db, &thread_id).map_err(|e| e.to_string())?;
    Ok(ThreadDetail { thread, messages })
}

/// Get all messages for a thread.
#[tauri::command]
pub fn thread_get_messages(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<Vec<Message>, String> {
    let db = state.db.lock();
    message_queries::list_messages(&db, &thread_id).map_err(|e| e.to_string())
}

/// Delete a thread and all related data. Cancels any running agent first.
#[tauri::command]
pub fn thread_delete(
    _app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<(), String> {
    // Cancel the agent if it is still running
    if agent_orchestrator::is_running(&state, &thread_id) {
        agent_orchestrator::cancel(&state, &thread_id);
    }

    let db = state.db.lock();
    thread_queries::delete_thread(&db, &thread_id).map_err(|e| e.to_string())
}

/// Fork (duplicate) a thread and its messages into a new thread.
#[tauri::command]
pub fn thread_fork(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadInfo, String> {
    let db = state.db.lock();

    // Fetch the original thread
    let original = thread_queries::get_thread(&db, &thread_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Thread not found: {}", thread_id))?;

    // Create forked thread
    let new_id = uuid::Uuid::new_v4().to_string();
    let forked_title = format!(
        "{} (fork)",
        original.title.as_deref().unwrap_or("Untitled")
    );

    let new_thread = thread_queries::create_thread(
        &db,
        &new_id,
        &original.project_id,
        Some(&forked_title),
        None,
        original.worktree_path.as_deref(),
        original.worktree_branch.as_deref(),
        original.provider.as_deref(),
        original.model.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    // Copy messages
    let messages = message_queries::list_messages(&db, &thread_id).map_err(|e| e.to_string())?;
    for msg in &messages {
        let msg_id = uuid::Uuid::new_v4().to_string();
        message_queries::add_message(
            &db,
            &msg_id,
            &new_id,
            &msg.role,
            &msg.content,
            msg.cost_usd,
            msg.tokens_in,
            msg.tokens_out,
            msg.model_id.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    }

    // Update forked thread status to completed (it is a snapshot)
    thread_queries::update_thread_status(&db, &new_id, "completed").map_err(|e| e.to_string())?;

    Ok(new_thread)
}

/// Get the cost summary for a thread.
#[tauri::command]
pub fn thread_get_cost_summary(
    state: tauri::State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadCostSummary, String> {
    // Try to get live cost from orchestrator first
    if let Some(cost_info) = agent_orchestrator::get_agent_cost(&state, &thread_id) {
        return Ok(ThreadCostSummary {
            thread_id: thread_id.clone(),
            total_cost_usd: cost_info.cost_usd,
            total_tokens_in: cost_info.tokens_in,
            total_tokens_out: cost_info.tokens_out,
            model_usage: cost_info.model_usage,
        });
    }

    // Fall back to database aggregation
    let db = state.db.lock();
    let messages = message_queries::list_messages(&db, &thread_id).map_err(|e| e.to_string())?;

    let mut total_cost: f64 = 0.0;
    let mut total_in: i64 = 0;
    let mut total_out: i64 = 0;

    for msg in &messages {
        if let Some(c) = msg.cost_usd {
            total_cost += c;
        }
        if let Some(t) = msg.tokens_in {
            total_in += t;
        }
        if let Some(t) = msg.tokens_out {
            total_out += t;
        }
    }

    let model_usage =
        model_usage_queries::get_thread_model_usage(&db, &thread_id).map_err(|e| e.to_string())?;

    Ok(ThreadCostSummary {
        thread_id,
        total_cost_usd: total_cost,
        total_tokens_in: total_in,
        total_tokens_out: total_out,
        model_usage,
    })
}

/// Update the provider and model for a thread.
#[tauri::command]
pub fn thread_update_provider(
    state: tauri::State<'_, AppState>,
    thread_id: String,
    provider: ProviderType,
    model: String,
) -> Result<(), String> {
    let provider_str = match provider {
        ProviderType::Claude => "claude",
        ProviderType::Copilot => "copilot",
    };
    let db = state.db.lock();
    thread_queries::update_thread_provider(&db, &thread_id, Some(provider_str), Some(&model))
        .map_err(|e| e.to_string())
}
