import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import type {
  Project,
  ProjectSettings,
  ThreadInfo,
  Message,
  MessageContent,
  Skill,
  Automation,
  AutomationRun,
  AppSettings,
  ModelTokenUsage,
} from "../../src/types/ipc";

let db: SqlJsDatabase | null = null;
let dbPath: string = "";

const SCHEMA = `
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
`;

function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call storage.initialize() first.");
  }
  return db;
}

function saveToFile(): void {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    logger.error("storage", "Failed to save database", err);
  }
}

export const storage = {
  async initialize(databasePath: string): Promise<void> {
    dbPath = databasePath;
    const SQL = await initSqlJs();

    const dir = path.dirname(databasePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(databasePath)) {
      const fileBuffer = fs.readFileSync(databasePath);
      db = new SQL.Database(fileBuffer);
      logger.info("storage", `Loaded database from ${databasePath}`);
    } else {
      db = new SQL.Database();
      logger.info("storage", `Created new database at ${databasePath}`);
    }

    db.run("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);

    // Migration: add model_id column to messages if not present
    try {
      db.exec("ALTER TABLE messages ADD COLUMN model_id TEXT");
    } catch {
      // Column already exists - ignore
    }

    // Migration: add provider/model columns to threads if not present
    try {
      db.exec("ALTER TABLE threads ADD COLUMN provider TEXT");
    } catch {
      // Column already exists - ignore
    }
    try {
      db.exec("ALTER TABLE threads ADD COLUMN model TEXT");
    } catch {
      // Column already exists - ignore
    }

    saveToFile();
  },

  close(): void {
    if (db) {
      saveToFile();
      db.close();
      db = null;
      logger.info("storage", "Database closed");
    }
  },

  // ── Projects ──────────────────────────────────────────────

  listProjects(): Project[] {
    const stmt = getDb().prepare("SELECT * FROM projects ORDER BY last_opened_at DESC");
    const rows: Project[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push(mapProject(row));
    }
    stmt.free();
    return rows;
  },

  addProject(id: string, name: string, projectPath: string): Project {
    const now = new Date().toISOString();
    getDb().run(
      "INSERT INTO projects (id, name, path, created_at, last_opened_at, settings) VALUES (?, ?, ?, ?, ?, ?)",
      [id, name, projectPath, now, now, "{}"]
    );
    saveToFile();
    return { id, name, path: projectPath, createdAt: now, lastOpenedAt: now, settings: {} };
  },

  removeProject(id: string): void {
    getDb().run("DELETE FROM thread_notes WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)", [id]);
    getDb().run("DELETE FROM model_usage WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)", [id]);
    getDb().run("DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)", [id]);
    getDb().run("DELETE FROM threads WHERE project_id = ?", [id]);
    getDb().run("DELETE FROM automation_runs WHERE automation_id IN (SELECT id FROM automations WHERE project_id = ?)", [id]);
    getDb().run("DELETE FROM automations WHERE project_id = ?", [id]);
    getDb().run("DELETE FROM projects WHERE id = ?", [id]);
    saveToFile();
  },

  getProject(id: string): Project | null {
    const stmt = getDb().prepare("SELECT * FROM projects WHERE id = ?");
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return mapProject(row);
  },

  updateProjectSettings(id: string, settings: Partial<ProjectSettings>): void {
    const project = this.getProject(id);
    if (!project) throw new Error(`Project not found: ${id}`);
    const merged = { ...project.settings, ...settings };
    getDb().run("UPDATE projects SET settings = ? WHERE id = ?", [JSON.stringify(merged), id]);
    saveToFile();
  },

  touchProject(id: string): void {
    getDb().run("UPDATE projects SET last_opened_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    saveToFile();
  },

  // ── Threads ───────────────────────────────────────────────

  listThreads(projectId: string): ThreadInfo[] {
    const stmt = getDb().prepare("SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC");
    stmt.bind([projectId]);
    const rows: ThreadInfo[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push(mapThread(row));
    }
    stmt.free();
    return rows;
  },

  createThread(
    id: string, projectId: string, title: string | null,
    sessionId: string | null, worktreePath: string | null, worktreeBranch: string | null,
    provider?: string | null, model?: string | null
  ): ThreadInfo {
    const now = new Date().toISOString();
    getDb().run(
      `INSERT INTO threads (id, project_id, title, status, session_id, worktree_path, worktree_branch, provider, model, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, title, sessionId, worktreePath, worktreeBranch, provider ?? null, model ?? null, now, now]
    );
    saveToFile();
    return { id, projectId, title, status: "running", sessionId, worktreePath, worktreeBranch, provider: (provider as import("../../src/types/ipc").ProviderType) ?? null, model: model ?? null, createdAt: now, updatedAt: now };
  },

  getThread(id: string): ThreadInfo | null {
    const stmt = getDb().prepare("SELECT * FROM threads WHERE id = ?");
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return mapThread(row);
  },

  updateThreadStatus(id: string, status: ThreadInfo["status"]): void {
    getDb().run("UPDATE threads SET status = ?, updated_at = ? WHERE id = ?", [status, new Date().toISOString(), id]);
    saveToFile();
  },

  updateThreadSession(id: string, sessionId: string): void {
    getDb().run("UPDATE threads SET session_id = ?, updated_at = ? WHERE id = ?", [sessionId, new Date().toISOString(), id]);
    saveToFile();
  },

  updateThreadWorktree(id: string, worktreePath: string | null, worktreeBranch: string | null): void {
    getDb().run("UPDATE threads SET worktree_path = ?, worktree_branch = ?, updated_at = ? WHERE id = ?", [worktreePath, worktreeBranch, new Date().toISOString(), id]);
    saveToFile();
  },

  updateThreadProvider(id: string, provider: string | null, model: string | null): void {
    getDb().run("UPDATE threads SET provider = ?, model = ?, updated_at = ? WHERE id = ?", [provider, model, new Date().toISOString(), id]);
    saveToFile();
  },

  markStaleRunningThreads(): void {
    const now = new Date().toISOString();
    getDb().run(
      "UPDATE threads SET status = 'failed', updated_at = ? WHERE status = 'running'",
      [now]
    );
    saveToFile();
  },

  deleteThread(id: string): void {
    getDb().run("DELETE FROM thread_notes WHERE thread_id = ?", [id]);
    getDb().run("DELETE FROM model_usage WHERE thread_id = ?", [id]);
    getDb().run("DELETE FROM messages WHERE thread_id = ?", [id]);
    getDb().run("DELETE FROM threads WHERE id = ?", [id]);
    saveToFile();
  },

  // ── Messages ──────────────────────────────────────────────

  listMessages(threadId: string): Message[] {
    const stmt = getDb().prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC");
    stmt.bind([threadId]);
    const rows: Message[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push(mapMessage(row));
    }
    stmt.free();
    return rows;
  },

  addMessage(
    id: string, threadId: string, role: Message["role"],
    content: MessageContent[], costUsd: number | null,
    tokensIn: number | null, tokensOut: number | null,
    modelId?: string | null,
  ): Message {
    const now = new Date().toISOString();
    getDb().run(
      `INSERT INTO messages (id, thread_id, role, content, cost_usd, tokens_in, tokens_out, model_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, threadId, role, JSON.stringify(content), costUsd, tokensIn, tokensOut, modelId ?? null, now]
    );
    getDb().run("UPDATE threads SET updated_at = ? WHERE id = ?", [now, threadId]);
    saveToFile();
    return { id, threadId, role, content, costUsd, tokensIn, tokensOut, modelId: modelId ?? null, createdAt: now };
  },

  // ── Skills ────────────────────────────────────────────────

  listSkills(): Skill[] {
    const stmt = getDb().prepare("SELECT * FROM skills ORDER BY name ASC");
    const rows: Skill[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push(mapSkill(row));
    }
    stmt.free();
    return rows;
  },

  addSkill(id: string, name: string, description: string, scope: Skill["scope"], skillPath: string): Skill {
    const now = new Date().toISOString();
    getDb().run(
      "INSERT INTO skills (id, name, description, scope, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, name, description, scope, skillPath, now, now]
    );
    saveToFile();
    return { id, name, description, scope, path: skillPath, createdAt: now, updatedAt: now };
  },

  deleteSkill(id: string): void {
    getDb().run("DELETE FROM skills WHERE id = ?", [id]);
    saveToFile();
  },

  // ── Automations ───────────────────────────────────────────

  listAutomations(projectId: string): Automation[] {
    const stmt = getDb().prepare("SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC");
    stmt.bind([projectId]);
    const rows: Automation[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push(mapAutomation(row));
    }
    stmt.free();
    return rows;
  },

  getAutomation(id: string): Automation | null {
    const stmt = getDb().prepare("SELECT * FROM automations WHERE id = ?");
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return mapAutomation(row);
  },

  addAutomation(
    id: string, projectId: string, name: string, prompt: string,
    triggerType: Automation["triggerType"], triggerConfig: Record<string, unknown>,
    skillIds: string[], schedule: string | null, enabled: boolean
  ): Automation {
    getDb().run(
      `INSERT INTO automations (id, project_id, name, prompt, skill_ids, schedule, trigger_type, trigger_config, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, name, prompt, JSON.stringify(skillIds), schedule, triggerType, JSON.stringify(triggerConfig), enabled ? 1 : 0]
    );
    saveToFile();
    return this.getAutomation(id)!;
  },

  updateAutomation(id: string, updates: {
    name?: string; prompt?: string; skillIds?: string[]; schedule?: string | null;
    triggerType?: Automation["triggerType"]; triggerConfig?: Record<string, unknown>;
    enabled?: boolean; lastRunAt?: string;
  }): Automation {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
    if (updates.prompt !== undefined) { sets.push("prompt = ?"); vals.push(updates.prompt); }
    if (updates.skillIds !== undefined) { sets.push("skill_ids = ?"); vals.push(JSON.stringify(updates.skillIds)); }
    if (updates.schedule !== undefined) { sets.push("schedule = ?"); vals.push(updates.schedule); }
    if (updates.triggerType !== undefined) { sets.push("trigger_type = ?"); vals.push(updates.triggerType); }
    if (updates.triggerConfig !== undefined) { sets.push("trigger_config = ?"); vals.push(JSON.stringify(updates.triggerConfig)); }
    if (updates.enabled !== undefined) { sets.push("enabled = ?"); vals.push(updates.enabled ? 1 : 0); }
    if (updates.lastRunAt !== undefined) { sets.push("last_run_at = ?"); vals.push(updates.lastRunAt); }
    if (sets.length > 0) {
      vals.push(id);
      getDb().run(`UPDATE automations SET ${sets.join(", ")} WHERE id = ?`, vals);
      saveToFile();
    }
    return this.getAutomation(id)!;
  },

  deleteAutomation(id: string): void {
    getDb().run("DELETE FROM automation_runs WHERE automation_id = ?", [id]);
    getDb().run("DELETE FROM automations WHERE id = ?", [id]);
    saveToFile();
  },

  // ── Automation Runs ───────────────────────────────────────

  listAutomationRuns(automationId: string): AutomationRun[] {
    const stmt = getDb().prepare("SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC");
    stmt.bind([automationId]);
    const rows: AutomationRun[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push(mapAutomationRun(row));
    }
    stmt.free();
    return rows;
  },

  addAutomationRun(id: string, automationId: string): AutomationRun {
    getDb().run(
      "INSERT INTO automation_runs (id, automation_id, status) VALUES (?, ?, 'running')",
      [id, automationId]
    );
    saveToFile();
    return this.getAutomationRun(id)!;
  },

  getAutomationRun(id: string): AutomationRun | null {
    const stmt = getDb().prepare("SELECT * FROM automation_runs WHERE id = ?");
    stmt.bind([id]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return mapAutomationRun(row);
  },

  updateAutomationRun(id: string, updates: {
    status?: AutomationRun["status"]; result?: Record<string, unknown>;
    read?: boolean; finishedAt?: string;
  }): AutomationRun {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (updates.status !== undefined) { sets.push("status = ?"); vals.push(updates.status); }
    if (updates.result !== undefined) { sets.push("result = ?"); vals.push(JSON.stringify(updates.result)); }
    if (updates.read !== undefined) { sets.push("read = ?"); vals.push(updates.read ? 1 : 0); }
    if (updates.finishedAt !== undefined) { sets.push("finished_at = ?"); vals.push(updates.finishedAt); }
    if (sets.length > 0) {
      vals.push(id);
      getDb().run(`UPDATE automation_runs SET ${sets.join(", ")} WHERE id = ?`, vals);
      saveToFile();
    }
    return this.getAutomationRun(id)!;
  },

  listInboxRuns(filters?: { automationId?: string; status?: string; projectId?: string; unreadOnly?: boolean }): AutomationRun[] {
    let sql = "SELECT ar.* FROM automation_runs ar JOIN automations a ON ar.automation_id = a.id WHERE 1=1";
    const params: unknown[] = [];
    if (filters?.automationId) { sql += " AND ar.automation_id = ?"; params.push(filters.automationId); }
    if (filters?.status) { sql += " AND ar.status = ?"; params.push(filters.status); }
    if (filters?.projectId) { sql += " AND a.project_id = ?"; params.push(filters.projectId); }
    if (filters?.unreadOnly) { sql += " AND ar.read = 0"; }
    sql += " ORDER BY ar.started_at DESC";
    const stmt = getDb().prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows: AutomationRun[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push(mapAutomationRun(row));
    }
    stmt.free();
    return rows;
  },

  // ── Model Usage ─────────────────────────────────────────

  addModelUsage(threadId: string, modelUsage: Record<string, ModelTokenUsage>): void {
    for (const [model, usage] of Object.entries(modelUsage)) {
      getDb().run(
        `INSERT INTO model_usage (thread_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [threadId, model, usage.inputTokens, usage.outputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens, usage.costUsd]
      );
    }
    saveToFile();
  },

  getThreadModelUsage(threadId: string): Record<string, ModelTokenUsage> {
    const stmt = getDb().prepare(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cache_read_tokens) as cache_read_tokens,
              SUM(cache_creation_tokens) as cache_creation_tokens,
              SUM(cost_usd) as cost_usd
       FROM model_usage WHERE thread_id = ? GROUP BY model`
    );
    stmt.bind([threadId]);
    const result: Record<string, ModelTokenUsage> = {};
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result[row.model as string] = {
        inputTokens: (row.input_tokens as number) || 0,
        outputTokens: (row.output_tokens as number) || 0,
        cacheReadInputTokens: (row.cache_read_tokens as number) || 0,
        cacheCreationInputTokens: (row.cache_creation_tokens as number) || 0,
        costUsd: (row.cost_usd as number) || 0,
      };
    }
    stmt.free();
    return result;
  },

  getAllProjectCosts(): Map<string, number> {
    const stmt = getDb().prepare(
      `SELECT t.project_id, SUM(m.cost_usd) as total_cost
       FROM messages m JOIN threads t ON m.thread_id = t.id
       WHERE m.cost_usd IS NOT NULL
       GROUP BY t.project_id`
    );
    const costs = new Map<string, number>();
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      costs.set(row.project_id as string, (row.total_cost as number) || 0);
    }
    stmt.free();
    return costs;
  },

  getGlobalModelUsageFromDb(): Record<string, ModelTokenUsage> {
    const stmt = getDb().prepare(
      `SELECT model,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens,
              SUM(cache_read_tokens) as cache_read_tokens,
              SUM(cache_creation_tokens) as cache_creation_tokens,
              SUM(cost_usd) as cost_usd
       FROM model_usage GROUP BY model`
    );
    const result: Record<string, ModelTokenUsage> = {};
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      result[row.model as string] = {
        inputTokens: (row.input_tokens as number) || 0,
        outputTokens: (row.output_tokens as number) || 0,
        cacheReadInputTokens: (row.cache_read_tokens as number) || 0,
        cacheCreationInputTokens: (row.cache_creation_tokens as number) || 0,
        costUsd: (row.cost_usd as number) || 0,
      };
    }
    stmt.free();
    return result;
  },

  // ── Thread Notes ─────────────────────────────────────────

  getThreadNote(threadId: string): string | null {
    const stmt = getDb().prepare("SELECT content FROM thread_notes WHERE thread_id = ?");
    stmt.bind([threadId]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return (row.content as string) ?? null;
  },

  saveThreadNote(threadId: string, content: string): void {
    getDb().run(
      `INSERT INTO thread_notes (thread_id, content, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      [threadId, content, new Date().toISOString()]
    );
    saveToFile();
  },

  deleteThreadNote(threadId: string): void {
    getDb().run("DELETE FROM thread_notes WHERE thread_id = ?", [threadId]);
    saveToFile();
  },

  // ── App Settings ──────────────────────────────────────────

  getSetting(key: string): unknown {
    const stmt = getDb().prepare("SELECT value FROM app_settings WHERE key = ?");
    stmt.bind([key]);
    if (!stmt.step()) { stmt.free(); return undefined; }
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();
    return JSON.parse(row.value as string) as unknown;
  },

  setSetting(key: string, value: unknown): void {
    getDb().run("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [key, JSON.stringify(value)]);
    saveToFile();
  },

  getAppSettings(): AppSettings {
    const saved = this.getSetting("app_settings") as Partial<AppSettings> | undefined;
    return {
      theme: "dark", defaultModel: "sonnet",
      maxConcurrentAgents: 3, defaultBudgetLimitUsd: 10.0,
      defaultTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      permissionMode: "ask" as const,
      defaultSandboxPolicy: "workspace-write" as const,
      automationsEnabled: true, notifyOnCompletion: true, notifyOnFailure: true,
      fontSize: 14, interactionStyle: "detailed" as const,
      diffViewMode: "unified" as const, claudeCliPath: null,
      logLevel: "info" as const, skillDirectories: [],
      ...saved,
    };
  },

  updateAppSettings(settings: Partial<AppSettings>): void {
    const current = this.getAppSettings();
    this.setSetting("app_settings", { ...current, ...settings });
  },
};

// ── Row Mappers ───────────────────────────────────────────────

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string, name: row.name as string, path: row.path as string,
    createdAt: row.created_at as string, lastOpenedAt: (row.last_opened_at as string) || null,
    settings: JSON.parse((row.settings as string) || "{}") as ProjectSettings,
  };
}

function mapThread(row: Record<string, unknown>): ThreadInfo {
  return {
    id: row.id as string, projectId: row.project_id as string,
    title: (row.title as string) || null, status: row.status as ThreadInfo["status"],
    sessionId: (row.session_id as string) || null,
    worktreePath: (row.worktree_path as string) || null,
    worktreeBranch: (row.worktree_branch as string) || null,
    provider: (row.provider as string as import("../../src/types/ipc").ProviderType) || null,
    model: (row.model as string) || null,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string, threadId: row.thread_id as string,
    role: row.role as Message["role"],
    content: JSON.parse(row.content as string) as MessageContent[],
    costUsd: row.cost_usd != null ? (row.cost_usd as number) : null,
    tokensIn: row.tokens_in != null ? (row.tokens_in as number) : null,
    tokensOut: row.tokens_out != null ? (row.tokens_out as number) : null,
    modelId: (row.model_id as string) || null,
    createdAt: row.created_at as string,
  };
}

function mapSkill(row: Record<string, unknown>): Skill {
  return {
    id: row.id as string, name: row.name as string,
    description: (row.description as string) || "", scope: row.scope as Skill["scope"],
    path: row.path as string, createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  };
}

function mapAutomation(row: Record<string, unknown>): Automation {
  return {
    id: row.id as string, projectId: row.project_id as string,
    name: row.name as string, prompt: row.prompt as string,
    skillIds: JSON.parse((row.skill_ids as string) || "[]") as string[],
    schedule: (row.schedule as string) || null,
    triggerType: row.trigger_type as Automation["triggerType"],
    triggerConfig: JSON.parse((row.trigger_config as string) || "{}") as Record<string, unknown>,
    enabled: (row.enabled as number) === 1,
    lastRunAt: (row.last_run_at as string) || null, createdAt: row.created_at as string,
  };
}

function mapAutomationRun(row: Record<string, unknown>): AutomationRun {
  return {
    id: row.id as string, automationId: row.automation_id as string,
    status: row.status as AutomationRun["status"],
    result: row.result ? (JSON.parse(row.result as string) as Record<string, unknown>) : null,
    read: (row.read as number) === 1,
    startedAt: row.started_at as string, finishedAt: (row.finished_at as string) || null,
  };
}
