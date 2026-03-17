use tracing::debug;

use crate::state::{AppState, SessionEntry};

/// Register a Claude CLI session for a given thread.
pub fn register(state: &AppState, thread_id: &str, session_id: &str) {
    let mut sessions = state.sessions.write();
    sessions.insert(
        thread_id.to_string(),
        SessionEntry {
            thread_id: thread_id.to_string(),
            session_id: session_id.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    );
    debug!(
        target: "session-registry",
        "Registered session {} for thread {}", session_id, thread_id
    );
}

/// Get the CLI session ID for a given thread.
pub fn get_session_id(state: &AppState, thread_id: &str) -> Option<String> {
    let sessions = state.sessions.read();
    sessions.get(thread_id).map(|e| e.session_id.clone())
}

/// Look up which thread owns a given session ID.
pub fn get_thread_id(state: &AppState, session_id: &str) -> Option<String> {
    let sessions = state.sessions.read();
    for entry in sessions.values() {
        if entry.session_id == session_id {
            return Some(entry.thread_id.clone());
        }
    }
    None
}

/// Remove a session entry for the given thread.
pub fn remove(state: &AppState, thread_id: &str) {
    let mut sessions = state.sessions.write();
    sessions.remove(thread_id);
}

/// Check whether a session is registered for the given thread.
pub fn has_session(state: &AppState, thread_id: &str) -> bool {
    let sessions = state.sessions.read();
    sessions.contains_key(thread_id)
}

/// Return a snapshot of all registered sessions.
pub fn get_all_sessions(state: &AppState) -> Vec<SessionEntry> {
    let sessions = state.sessions.read();
    sessions.values().cloned().collect()
}

/// Clear all registered sessions.
pub fn clear(state: &AppState) {
    let mut sessions = state.sessions.write();
    sessions.clear();
}
