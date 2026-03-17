use tauri::{AppHandle, Emitter};
use tracing::warn;

use crate::db::models::AppNotification;
use crate::state::AppState;

/// Maximum number of notifications to keep in history.
const MAX_HISTORY: usize = 100;

/// Send a notification both to the in-memory history and to the frontend.
///
/// The Tauri notification plugin can be used for native OS notifications
/// if desired; this function focuses on the in-app notification channel.
pub fn notify(
    app_handle: &AppHandle,
    state: &AppState,
    notification_type: &str,
    title: &str,
    message: &str,
) -> AppNotification {
    let notification = AppNotification {
        id: uuid::Uuid::new_v4().to_string(),
        notification_type: notification_type.to_string(),
        title: title.to_string(),
        message: message.to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    // Store in history (most recent first)
    {
        let mut history = state.notifications.lock();
        history.insert(0, notification.clone());
        if history.len() > MAX_HISTORY {
            history.truncate(MAX_HISTORY);
        }
    }

    // Forward to renderer
    if let Err(e) = app_handle.emit("notification", &notification) {
        warn!(
            target: "notification-service",
            "Failed to emit notification to renderer: {}", e
        );
    }

    notification
}

/// Get the full notification history.
pub fn get_history(state: &AppState) -> Vec<AppNotification> {
    let history = state.notifications.lock();
    history.clone()
}

/// Clear all notification history.
pub fn clear_history(state: &AppState) {
    let mut history = state.notifications.lock();
    history.clear();
}
