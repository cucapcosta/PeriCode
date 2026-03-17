/// The complete database schema. Matches the TypeScript version exactly.
pub const SCHEMA: &str = r#"
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_opened_at DATETIME,
    settings JSON DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT,
    status TEXT CHECK(status IN ('running','paused','completed','failed')) DEFAULT 'running',
    session_id TEXT,
    worktree_path TEXT,
    worktree_branch TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id),
    role TEXT CHECK(role IN ('user','assistant','system','tool_use','tool_result')),
    content JSON NOT NULL,
    cost_usd REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT CHECK(scope IN ('system','user','project')) DEFAULT 'user',
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    skill_ids JSON DEFAULT '[]',
    schedule TEXT,
    trigger_type TEXT CHECK(trigger_type IN ('cron','file_change','git_event','manual')),
    trigger_config JSON DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    last_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id),
    status TEXT CHECK(status IN ('running','completed','failed','archived')),
    result JSON,
    read INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSON NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_creation_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);
  CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id);
  CREATE INDEX IF NOT EXISTS idx_model_usage_thread ON model_usage(thread_id);

  CREATE TABLE IF NOT EXISTS thread_notes (
    thread_id TEXT PRIMARY KEY REFERENCES threads(id),
    content TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
"#;
