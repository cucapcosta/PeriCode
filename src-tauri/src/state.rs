use std::collections::HashMap;
use parking_lot::{Mutex, RwLock};
use rusqlite::Connection;
use tokio::sync::broadcast;
use serde::{Serialize, Deserialize};

// Re-export ModelTokenUsage from the canonical db::models definition
// so all code uses a single type.
pub use crate::db::models::ModelTokenUsage;

// Forward declaration types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStreamEvent {
    pub thread_id: String,
    pub event_type: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct SessionEntry {
    pub thread_id: String,
    pub session_id: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct ActiveAgent {
    pub thread_id: String,
    pub project_id: String,
    /// Unique identifier for this agent run. Used to prevent a stale
    /// `run_agent_events` cleanup from removing a newer agent entry.
    pub run_id: String,
    pub cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
    pub stdin_tx: Option<tokio::sync::mpsc::Sender<String>>,
    pub cost_usd: f64,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub model_usage: HashMap<String, ModelTokenUsage>,
}

#[derive(Debug, Default)]
pub struct OrchestratorState {
    pub active_agents: HashMap<String, ActiveAgent>,
    pub queued_count: usize,
    pub project_costs: HashMap<String, f64>,
    pub global_model_usage: HashMap<String, ModelTokenUsage>,
    pub max_concurrent: usize,
    pub previous_cumulative_cost: HashMap<String, f64>,
    pub previous_cumulative_model_usage: HashMap<String, HashMap<String, ModelTokenUsage>>,
}

impl OrchestratorState {
    pub fn new() -> Self {
        Self {
            max_concurrent: 3,
            ..Default::default()
        }
    }
}

#[derive(Debug)]
pub struct TerminalSession {
    pub id: String,
    pub cwd: String,
    pub stdin_tx: Option<std::sync::mpsc::Sender<Vec<u8>>>,
    pub kill_tx: Option<std::sync::mpsc::Sender<()>>,
}

#[derive(Debug, Default)]
pub struct SchedulerState {
    pub scheduled: HashMap<String, ScheduledTask>,
}

#[derive(Debug)]
pub struct ScheduledTask {
    pub automation_id: String,
    pub cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub orchestrator: RwLock<OrchestratorState>,
    pub sessions: RwLock<HashMap<String, SessionEntry>>,
    pub terminals: Mutex<HashMap<String, TerminalSession>>,
    pub scheduler: Mutex<SchedulerState>,
    pub notifications: Mutex<Vec<crate::db::models::AppNotification>>,
    pub agent_event_tx: broadcast::Sender<AgentStreamEvent>,
}

/// Merge source model usage into target, summing token counts and costs.
pub fn merge_model_usage(
    target: &mut HashMap<String, ModelTokenUsage>,
    source: &HashMap<String, ModelTokenUsage>,
) {
    for (model, usage) in source {
        let entry = target.entry(model.clone()).or_insert_with(|| ModelTokenUsage {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cost_usd: 0.0,
        });
        entry.input_tokens += usage.input_tokens;
        entry.output_tokens += usage.output_tokens;
        entry.cache_read_input_tokens += usage.cache_read_input_tokens;
        entry.cache_creation_input_tokens += usage.cache_creation_input_tokens;
        entry.cost_usd += usage.cost_usd;
    }
}

impl AppState {
    pub fn new(db: Connection) -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self {
            db: Mutex::new(db),
            orchestrator: RwLock::new(OrchestratorState::new()),
            sessions: RwLock::new(HashMap::new()),
            terminals: Mutex::new(HashMap::new()),
            scheduler: Mutex::new(SchedulerState::default()),
            notifications: Mutex::new(Vec::new()),
            agent_event_tx: tx,
        }
    }
}
