/**
 * Provider Abstraction Layer Types
 * Unified interfaces for multi-provider agent system
 */

// ── Provider Types ────────────────────────────────────────

export type ProviderType = "claude" | "copilot";

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
}

export interface ProviderInfo {
  id: ProviderType;
  name: string;
  available: boolean;
  description?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  /** If true, model requires /responses endpoint instead of /chat/completions */
  responsesApi?: boolean;
  /** Premium request multiplier (0 = included free, 1 = standard, etc.) */
  premiumMultiplier?: number;
}

// ── Tool Definitions ──────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Unified Message Types ─────────────────────────────────

export type ToolCallMessageType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "cost"
  | "status"
  | "error"
  | "system";

export interface ToolCallMessage {
  type: ToolCallMessageType;

  // Text content
  text?: string;
  isPartial?: boolean;
  blockIndex?: number;

  // Tool use
  toolId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;

  // Tool result
  toolOutput?: string;

  // Cost tracking
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
  modelUsage?: Record<string, ModelTokenUsage>;

  // Status
  status?: "init" | "running" | "completed" | "failed";
  sessionId?: string;
  errorMessage?: string;
}

export interface ModelTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

// ── Agent Run Options ─────────────────────────────────────

export type PermissionMode = "ask" | "acceptEdits" | "full";

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  provider: ProviderConfig;
  systemPrompt?: string;
  conversationHistory?: ToolCallMessage[];
  permissionMode: PermissionMode;
  resumeSessionId?: string;
  imagePaths?: string[];

  // Tool configuration
  allowedTools?: string[];
  disallowedTools?: string[];
}

// ── Provider Adapter Interface ────────────────────────────

export interface ProviderAdapter {
  /** Unique identifier for this provider */
  readonly name: ProviderType;

  /** Human-readable display name */
  readonly displayName: string;

  /** Check if provider is available/configured */
  isAvailable(): Promise<boolean>;

  /** Get available models for this provider */
  getModels(): Promise<ModelInfo[]>;

  /** Run agent and stream responses */
  runAgent(options: AgentRunOptions): AsyncGenerator<ToolCallMessage, void, undefined>;

  /** Cancel running agent */
  cancel(): void;
}

// ── Provider Settings ─────────────────────────────────────

export interface ClaudeProviderSettings {
  enabled: boolean;
  cliPath?: string;
  defaultModel: string;
}

export interface CopilotProviderSettings {
  enabled: boolean;
  authenticated: boolean;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  defaultModel: string;
  username?: string;
}

export interface ProvidersSettings {
  defaultProvider: ProviderType;
  claude: ClaudeProviderSettings;
  copilot: CopilotProviderSettings;
}

// ── Default Settings ──────────────────────────────────────

export const DEFAULT_PROVIDERS_SETTINGS: ProvidersSettings = {
  defaultProvider: "claude",
  claude: {
    enabled: true,
    defaultModel: "sonnet",
  },
  copilot: {
    enabled: false,
    authenticated: false,
    defaultModel: "gpt-4.1",
  },
};

// ── Model Catalogs ────────────────────────────────────────

export const CLAUDE_MODELS: ModelInfo[] = [
  { id: "opus", name: "Claude Opus 4.6", description: "Most capable, complex tasks" },
  { id: "sonnet", name: "Claude Sonnet 4.5", description: "Balanced performance" },
  { id: "haiku", name: "Claude Haiku 4.5", description: "Fast, lightweight" },
];

// Premium request cost: $0.04 USD per 1x premium request
export const COPILOT_PREMIUM_REQUEST_USD = 0.04;

export const COPILOT_MODELS: ModelInfo[] = [
  // OpenAI Codex Models (require /responses API)
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", description: "Newest codex model", responsesApi: true, premiumMultiplier: 1 },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", description: "Latest codex model", responsesApi: true, premiumMultiplier: 1 },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", description: "Max codex model", responsesApi: true, premiumMultiplier: 1 },
  { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", description: "Codex model", responsesApi: true, premiumMultiplier: 1 },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", description: "Small codex model", responsesApi: true, premiumMultiplier: 0.33 },
  // OpenAI Chat Models (/chat/completions)
  { id: "gpt-5.2", name: "GPT-5.2", description: "Latest GPT flagship", premiumMultiplier: 1 },
  { id: "gpt-5.1", name: "GPT-5.1", description: "GPT-5.1 general purpose", premiumMultiplier: 1 },
  { id: "gpt-5", name: "GPT-5", description: "GPT-5", premiumMultiplier: 1 },
  { id: "gpt-5-mini", name: "GPT-5 Mini", description: "Fast and affordable", premiumMultiplier: 0 },
  { id: "gpt-4.1", name: "GPT-4.1", description: "Fast general purpose", premiumMultiplier: 0 },
  { id: "gpt-4o", name: "GPT-4o", description: "Multimodal", premiumMultiplier: 0 },
  // OpenAI Reasoning Models (/chat/completions)
  { id: "o4-mini", name: "o4 Mini", description: "Fast reasoning", premiumMultiplier: 1 },
  { id: "o3", name: "o3", description: "Advanced reasoning", premiumMultiplier: 1 },
  { id: "o3-mini", name: "o3 Mini", description: "Compact reasoning", premiumMultiplier: 1 },
  // Anthropic Models (via Copilot)
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", description: "Most capable", premiumMultiplier: 3 },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5", description: "Previous gen most capable", premiumMultiplier: 3 },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", description: "Balanced performance", premiumMultiplier: 1 },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", description: "Previous gen balanced", premiumMultiplier: 1 },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", description: "Fast, lightweight", premiumMultiplier: 0.33 },
  // Google Models
  { id: "gemini-3-pro", name: "Gemini 3 Pro", description: "Google latest pro model", premiumMultiplier: 1 },
  { id: "gemini-3-flash", name: "Gemini 3 Flash", description: "Google latest fast model", premiumMultiplier: 0.33 },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "Google previous gen pro", premiumMultiplier: 1 },
  // xAI Models
  { id: "grok-code-fast-1", name: "Grok Code Fast 1", description: "xAI fast coding model", premiumMultiplier: 0.25 },
];
