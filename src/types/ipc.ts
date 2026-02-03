// Type-safe IPC channel definitions
// Maps channel names to their argument and return types

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string | null;
  settings: ProjectSettings;
}

export interface ProjectSettings {
  model?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  maxBudgetUsd?: number;
  maxConcurrentAgents?: number;
}

export interface ThreadInfo {
  id: string;
  projectId: string;
  title: string | null;
  status: "running" | "paused" | "completed" | "failed";
  sessionId: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadDetail extends ThreadInfo {
  messages: Message[];
}

export interface Message {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system" | "tool_use" | "tool_result";
  content: MessageContent[];
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
}

export interface MessageContent {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
}

export interface AgentLaunchConfig {
  projectId: string;
  prompt: string;
  model?: string;
  skillIds?: string[];
  useWorktree?: boolean;
}

export type AgentStatus = "running" | "paused" | "completed" | "failed";

export interface StreamMessage {
  type: "text" | "tool_use" | "tool_result" | "cost" | "status";
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  status?: AgentStatus;
}

export interface CostUpdate {
  threadCostUsd: number;
  sessionCostUsd: number;
}

export interface ErrorInfo {
  message: string;
  code?: string;
  stack?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  commitHash: string;
  isMain: boolean;
}

export interface GitStatus {
  modified: string[];
  added: string[];
  deleted: string[];
  renamed: string[];
  untracked: string[];
  staged: string[];
  conflicted: string[];
  isClean: boolean;
}

export interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  oldContent?: string;
  newContent?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  scope: "system" | "user" | "project";
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDetail extends Skill {
  content: string;
  model?: string;
  tools?: string[];
  maxBudgetUsd?: number;
}

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  scope: "user" | "project";
  model?: string;
  tools?: string[];
  maxBudgetUsd?: number;
}

export interface Automation {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  skillIds: string[];
  schedule: string | null;
  triggerType: "cron" | "file_change" | "git_event" | "manual";
  triggerConfig: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

export interface AutomationConfig {
  projectId: string;
  name: string;
  prompt: string;
  skillIds?: string[];
  schedule?: string;
  triggerType: "cron" | "file_change" | "git_event" | "manual";
  triggerConfig?: Record<string, unknown>;
  budgetLimitUsd?: number;
  sandboxPolicy?: "read-only" | "workspace-write" | "full";
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: "running" | "completed" | "failed" | "archived";
  result: Record<string, unknown> | null;
  read: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export interface InboxFilters {
  automationId?: string;
  status?: string;
  projectId?: string;
  unreadOnly?: boolean;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
  defaultModel: string;
  maxConcurrentAgents: number;
  defaultBudgetLimitUsd: number;
  fontSize: number;
  interactionStyle: "terse" | "detailed";
  diffViewMode: "unified" | "split";
  claudeCliPath: string | null;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface ProjectDetectionInfo {
  isGitRepo: boolean;
  hasClaudeMd: boolean;
  hasAgentsMd: boolean;
  claudeMdContent: string | null;
  agentsMdContent: string | null;
  defaultBranch: string | null;
}

export interface AppNotification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: string;
}

// IPC invoke channel map: channel name -> [args tuple, return type]
export interface IPCInvokeChannels {
  // Projects
  "project:list": { args: []; return: Project[] };
  "project:add": { args: [path: string]; return: Project };
  "project:remove": { args: [id: string]; return: void };
  "project:getSettings": { args: [id: string]; return: ProjectSettings };
  "project:updateSettings": {
    args: [id: string, settings: Partial<ProjectSettings>];
    return: void;
  };
  "project:openFolder": { args: []; return: Project | null };
  "project:detectInfo": {
    args: [projectId: string];
    return: ProjectDetectionInfo;
  };

  // Agents
  "agent:launch": { args: [config: AgentLaunchConfig]; return: ThreadInfo };
  "agent:pause": { args: [threadId: string]; return: void };
  "agent:resume": { args: [threadId: string]; return: void };
  "agent:cancel": { args: [threadId: string]; return: void };
  "agent:sendMessage": {
    args: [threadId: string, message: string];
    return: void;
  };
  "agent:getRunning": { args: []; return: ThreadInfo[] };

  // Threads
  "thread:list": { args: [projectId: string]; return: ThreadInfo[] };
  "thread:get": { args: [threadId: string]; return: ThreadDetail };
  "thread:getMessages": { args: [threadId: string]; return: Message[] };
  "thread:delete": { args: [threadId: string]; return: void };
  "thread:fork": { args: [threadId: string]; return: ThreadInfo };

  // Diff / Worktrees
  "worktree:getDiff": { args: [threadId: string]; return: FileDiff[] };
  "worktree:acceptAll": { args: [threadId: string]; return: void };
  "worktree:acceptFile": {
    args: [threadId: string, filePath: string];
    return: void;
  };
  "worktree:reject": { args: [threadId: string]; return: void };
  "worktree:openInEditor": {
    args: [threadId: string, filePath: string];
    return: void;
  };

  // Skills
  "skill:list": { args: []; return: Skill[] };
  "skill:get": { args: [id: string]; return: SkillDetail };
  "skill:create": { args: [definition: SkillDefinition]; return: Skill };
  "skill:update": {
    args: [id: string, definition: SkillDefinition];
    return: Skill;
  };
  "skill:delete": { args: [id: string]; return: void };
  "skill:export": { args: [id: string]; return: { path: string } };
  "skill:import": { args: [archivePath: string]; return: Skill };

  // Automations
  "automation:list": { args: [projectId: string]; return: Automation[] };
  "automation:create": {
    args: [config: AutomationConfig];
    return: Automation;
  };
  "automation:update": {
    args: [id: string, config: Partial<AutomationConfig>];
    return: Automation;
  };
  "automation:delete": { args: [id: string]; return: void };
  "automation:trigger": { args: [id: string]; return: AutomationRun };
  "automation:toggleEnabled": { args: [id: string]; return: void };
  "automation:getHistory": { args: [id: string]; return: AutomationRun[] };
  "automation:getInbox": {
    args: [filters?: InboxFilters];
    return: AutomationRun[];
  };
  "automation:markRead": { args: [runId: string]; return: void };
  "automation:archiveRun": { args: [runId: string]; return: void };

  // Settings
  "settings:get": { args: []; return: AppSettings };
  "settings:update": {
    args: [settings: Partial<AppSettings>];
    return: void;
  };
  "settings:getApiKeyStatus": {
    args: [];
    return: { valid: boolean; provider: string };
  };
}

// IPC event channel map (main -> renderer streaming)
export interface IPCEventChannels {
  "agent:message": [threadId: string, message: StreamMessage];
  "agent:status": [threadId: string, status: AgentStatus];
  "agent:error": [threadId: string, error: ErrorInfo];
  "agent:cost": [threadId: string, cost: CostUpdate];
  "automation:completed": [run: AutomationRun];
  notification: [notification: AppNotification];
}

// Valid IPC channel names
export type IPCInvokeChannel = keyof IPCInvokeChannels;
export type IPCEventChannel = keyof IPCEventChannels;
