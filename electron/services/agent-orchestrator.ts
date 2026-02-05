import type { BrowserWindow } from "electron";
import { spawnClaude } from "./claude-cli";
import { storage } from "./storage";
import { sessionRegistry } from "./session-registry";
import { worktreeManager } from "./worktree-manager";
import { logger } from "../utils/logger";
import { estimateCost } from "../utils/model-pricing";
import type {
  AgentLaunchConfig,
  AppSettings,
  ThreadInfo,
  MessageContent,
  StreamMessage,
  ModelTokenUsage,
} from "../../src/types/ipc";

// ── Types ──────────────────────────────────────────────────

export type AgentEventType =
  | "launched"
  | "completed"
  | "failed"
  | "cancelled"
  | "queued"
  | "dequeued"
  | "cost_update";

export interface AgentEvent {
  type: AgentEventType;
  threadId: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  errorMessage?: string;
}

type EventHandler = (event: AgentEvent) => void;

interface ActiveAgent {
  threadId: string;
  projectId: string;
  kill: () => void;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  modelUsage: Record<string, ModelTokenUsage>;
}

interface QueuedAgent {
  config: AgentLaunchConfig;
  threadId: string;
  resolve: (thread: ThreadInfo) => void;
  reject: (err: Error) => void;
}

// ── State ──────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
const activeAgents: Map<string, ActiveAgent> = new Map();
const agentQueue: QueuedAgent[] = [];
let maxConcurrent = 3;
const eventHandlers: Map<AgentEventType, EventHandler[]> = new Map();

// Budget tracking: per-project aggregate costs
const projectCosts: Map<string, number> = new Map();

// Global per-model token usage accumulator
const globalModelUsage: Record<string, ModelTokenUsage> = {};

// Previous cumulative cost per thread — used to compute deltas because
// Claude CLI's total_cost_usd and modelUsage are session-cumulative when
// using --resume, not per-interaction deltas.
const previousCumulativeCost: Map<string, number> = new Map();
const previousCumulativeModelUsage: Map<string, Record<string, ModelTokenUsage>> = new Map();

// ── Helpers ────────────────────────────────────────────────

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function emitEvent(event: AgentEvent): void {
  const handlers = eventHandlers.get(event.type) ?? [];
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      logger.warn("agent-orchestrator", "Event handler error", err);
    }
  }
}

function mergeModelUsage(
  target: Record<string, ModelTokenUsage>,
  source: Record<string, ModelTokenUsage>
): void {
  for (const [model, usage] of Object.entries(source)) {
    const existing = target[model];
    if (existing) {
      existing.inputTokens += usage.inputTokens;
      existing.outputTokens += usage.outputTokens;
      existing.cacheReadInputTokens += usage.cacheReadInputTokens;
      existing.cacheCreationInputTokens += usage.cacheCreationInputTokens;
      existing.costUsd += usage.costUsd;
    } else {
      target[model] = { ...usage };
    }
  }
}

function trackCost(
  threadId: string,
  projectId: string,
  costUsd: number,
  tokensIn: number,
  tokensOut: number,
  modelUsage?: Record<string, ModelTokenUsage>
): void {
  const agent = activeAgents.get(threadId);
  if (agent) {
    agent.costUsd += costUsd;
    agent.tokensIn += tokensIn;
    agent.tokensOut += tokensOut;
    if (modelUsage) {
      mergeModelUsage(agent.modelUsage, modelUsage);
    }
  }

  const currentProjectCost = projectCosts.get(projectId) ?? 0;
  projectCosts.set(projectId, currentProjectCost + costUsd);

  if (modelUsage) {
    mergeModelUsage(globalModelUsage, modelUsage);
  }

  // Notify renderer for StatusBar immediate refresh
  sendToRenderer("agent:cost", threadId, { threadCostUsd: costUsd, sessionCostUsd: 0 });

  emitEvent({
    type: "cost_update",
    threadId,
    costUsd,
    tokensIn,
    tokensOut,
  });
}

function canLaunch(): boolean {
  return activeAgents.size < maxConcurrent;
}

async function processQueue(): Promise<void> {
  while (agentQueue.length > 0 && canLaunch()) {
    const queued = agentQueue.shift();
    if (!queued) break;

    emitEvent({ type: "dequeued", threadId: queued.threadId });

    try {
      const thread = await launchImmediate(queued.config, queued.threadId);
      queued.resolve(thread);
    } catch (err) {
      queued.reject(
        err instanceof Error ? err : new Error("Agent launch failed")
      );
    }
  }
}

function getClaudeCliPath(): string | undefined {
  try {
    const settings = storage.getAppSettings();
    return settings.claudeCliPath ?? undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_TOOLS = [
  "Read", "Edit", "Write", "Bash",
  "Glob", "Grep", "WebSearch", "WebFetch",
];

// Tools that break non-interactive (-p) mode — plan mode requires user
// approval which is impossible in print mode, so the agent just plans
// and exits without implementing anything.
const DISALLOWED_TOOLS = ["EnterPlanMode"];

const NON_INTERACTIVE_SYSTEM_PROMPT =
  "You are running in non-interactive print mode. " +
  "DO NOT enter plan mode. Implement all requested changes directly. " +
  "Write code, create files, and make edits immediately without asking for confirmation.";

function resolvePermissionConfig(
  settings: AppSettings,
  configAllowedTools?: string[]
): { permissionMode: string; allowedTools: string[] } {
  switch (settings.permissionMode) {
    case "full":
      return { permissionMode: "bypassPermissions", allowedTools: DEFAULT_TOOLS };
    case "ask":
      // Use pre-flight tool selection if provided, otherwise default tools
      return {
        permissionMode: "acceptEdits",
        allowedTools: configAllowedTools && configAllowedTools.length > 0
          ? configAllowedTools
          : DEFAULT_TOOLS,
      };
    case "acceptEdits":
    default:
      return { permissionMode: "bypassPermissions", allowedTools: DEFAULT_TOOLS };
  }
}

/** Build prompt that includes image file path references for Claude CLI */
function buildPromptWithImages(prompt: string, imagePaths?: string[]): string {
  if (!imagePaths || imagePaths.length === 0) return prompt;
  // Prepend image paths so Claude CLI reads them as file references
  const imageRefs = imagePaths
    .map((p) => p.replace(/\\/g, "/"))
    .map((p) => `[Image: ${p}]`)
    .join("\n");
  return `${imageRefs}\n\n${prompt}`;
}

async function launchImmediate(
  config: AgentLaunchConfig,
  threadId: string
): Promise<ThreadInfo> {
  const title = config.prompt.slice(0, 100);

  // Create worktree if requested
  let worktreePath: string | null = null;
  let worktreeBranch: string | null = null;

  if (config.useWorktree) {
    const project = storage.getProject(config.projectId);
    if (project) {
      try {
        const wt = await worktreeManager.create(
          project.path,
          threadId,
          title
        );
        worktreePath = wt.path;
        worktreeBranch = wt.branch;
        logger.info(
          "agent-orchestrator",
          `Created worktree for agent ${threadId}: ${wt.path}`
        );
      } catch (err) {
        logger.warn(
          "agent-orchestrator",
          `Failed to create worktree, running in main repo`,
          err
        );
      }
    }
  }

  // Create thread in storage
  const thread = storage.createThread(
    threadId,
    config.projectId,
    title,
    null,
    worktreePath,
    worktreeBranch
  );

  // Store user message
  storage.addMessage(
    crypto.randomUUID(),
    threadId,
    "user",
    [{ type: "text", text: config.prompt }],
    null,
    null,
    null
  );

  // Start the agent in background
  const project = storage.getProject(config.projectId);
  const cwd = worktreePath ?? project?.path ?? process.cwd();

  // Determine permission mode and tool list from settings
  const appSettings = storage.getAppSettings();
  const { permissionMode: resolvedMode, allowedTools: resolvedTools } =
    resolvePermissionConfig(appSettings, config.allowedTools);

  const fullPrompt = buildPromptWithImages(config.prompt, config.imagePaths);

  const { events, kill } = spawnClaude({
    prompt: fullPrompt,
    cwd,
    model: config.model,
    permissionMode: resolvedMode,
    allowedTools: resolvedTools,
    disallowedTools: DISALLOWED_TOOLS,
    appendSystemPrompt: NON_INTERACTIVE_SYSTEM_PROMPT,
    claudePath: getClaudeCliPath(),
  });

  activeAgents.set(threadId, {
    threadId,
    projectId: config.projectId,
    kill,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    modelUsage: {},
  });

  emitEvent({ type: "launched", threadId });

  runAgent(threadId, config, events).catch((err) => {
    logger.error("agent-orchestrator", `Agent ${threadId} failed`, err);
  });

  return thread;
}

/** Shared streaming logic used by both runAgent and sendMessage */
function processAssistantEvent(
  threadId: string,
  message: import("./claude-cli").CliEvent,
  state: { lastSeenTextLength: number; currentBlockIndex: number; seenToolUseIds: Set<string> }
): void {
  // Handle content_block partials (from --include-partial-messages)
  if (message.content_block) {
    if (message.content_block.type === "text" && message.content_block.text) {
      const fullText = message.content_block.text;
      const delta = fullText.slice(state.lastSeenTextLength);
      state.lastSeenTextLength = fullText.length;

      if (delta) {
        sendToRenderer("agent:message", threadId, {
          type: "text",
          text: delta,
          blockIndex: state.currentBlockIndex,
        } as StreamMessage);
      }
    }
    return;
  }

  // Handle full message.content snapshots
  const apiMessage = message.message;
  if (!apiMessage || !Array.isArray(apiMessage.content)) return;

  for (const block of apiMessage.content) {
    if (block.type === "text") {
      const fullText = block.text ?? "";
      const delta = fullText.slice(state.lastSeenTextLength);
      state.lastSeenTextLength = fullText.length;

      if (delta) {
        sendToRenderer("agent:message", threadId, {
          type: "text",
          text: delta,
          blockIndex: state.currentBlockIndex,
        } as StreamMessage);
      }
    } else if (block.type === "tool_use") {
      // Deduplicate: only send tool_use once per unique tool call
      const toolId = (block as Record<string, unknown>).id as string | undefined;
      const dedupeKey = toolId ?? `${block.name}-${JSON.stringify(block.input)}`;
      if (state.seenToolUseIds.has(dedupeKey)) continue;
      state.seenToolUseIds.add(dedupeKey);

      // New tool_use block → advance block index, reset text length
      state.currentBlockIndex++;
      state.lastSeenTextLength = 0;

      sendToRenderer("agent:message", threadId, {
        type: "tool_use",
        toolName: block.name,
        toolInput: block.input as Record<string, unknown>,
        blockIndex: state.currentBlockIndex,
      } as StreamMessage);

      // Prepare for next text block after this tool
      state.currentBlockIndex++;
    }
  }
}

/** Compute per-model delta by subtracting previous cumulative snapshot. */
function computeModelUsageDelta(
  threadId: string,
  cumulativeUsage: Record<string, ModelTokenUsage>
): Record<string, ModelTokenUsage> {
  const prev = previousCumulativeModelUsage.get(threadId) ?? {};
  const delta: Record<string, ModelTokenUsage> = {};

  for (const [model, usage] of Object.entries(cumulativeUsage)) {
    const p = prev[model];
    if (p) {
      delta[model] = {
        inputTokens: Math.max(0, usage.inputTokens - p.inputTokens),
        outputTokens: Math.max(0, usage.outputTokens - p.outputTokens),
        cacheReadInputTokens: Math.max(0, usage.cacheReadInputTokens - p.cacheReadInputTokens),
        cacheCreationInputTokens: Math.max(0, usage.cacheCreationInputTokens - p.cacheCreationInputTokens),
        costUsd: Math.max(0, usage.costUsd - p.costUsd),
      };
    } else {
      delta[model] = { ...usage };
    }
  }

  // Save current cumulative as the new baseline (deep copy)
  const snapshot: Record<string, ModelTokenUsage> = {};
  for (const [model, usage] of Object.entries(cumulativeUsage)) {
    snapshot[model] = { ...usage };
  }
  previousCumulativeModelUsage.set(threadId, snapshot);

  return delta;
}

function processResultEvent(
  threadId: string,
  projectId: string,
  message: import("./claude-cli").CliEvent
): void {
  // Claude CLI total_cost_usd and modelUsage are session-cumulative when
  // using --resume.  Compute the delta since the last result for this thread.
  const cumulativeCost = message.total_cost_usd ?? 0;
  const prevCost = previousCumulativeCost.get(threadId) ?? 0;
  let deltaCost = Math.max(0, cumulativeCost - prevCost);
  previousCumulativeCost.set(threadId, cumulativeCost);

  const resultContent: MessageContent[] = [
    { type: "text", text: message.result ?? "" },
  ];

  // Parse cumulative model usage from CLI
  const cumulativeModelUsage: Record<string, ModelTokenUsage> | undefined =
    message.modelUsage
      ? Object.fromEntries(
          Object.entries(message.modelUsage).map(([model, u]) => {
            const input = u.inputTokens ?? 0;
            const output = u.outputTokens ?? 0;
            const cacheRead = u.cacheReadInputTokens ?? 0;
            const cacheCreate = u.cacheCreationInputTokens ?? 0;
            const cliCost = u.costUSD ?? 0;
            const cost = cliCost > 0
              ? cliCost
              : estimateCost(model, input, output, cacheCreate, cacheRead);
            return [
              model,
              {
                inputTokens: input,
                outputTokens: output,
                cacheReadInputTokens: cacheRead,
                cacheCreationInputTokens: cacheCreate,
                costUsd: cost,
              },
            ];
          })
        )
      : undefined;

  // Compute per-model delta
  const deltaModelUsage = cumulativeModelUsage
    ? computeModelUsageDelta(threadId, cumulativeModelUsage)
    : undefined;

  // Derive total token deltas from per-model delta breakdown
  let deltaTokensIn = message.usage?.input_tokens ?? 0;
  let deltaTokensOut = message.usage?.output_tokens ?? 0;
  if (deltaModelUsage) {
    let sumIn = 0;
    let sumOut = 0;
    for (const u of Object.values(deltaModelUsage)) {
      sumIn += u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
      sumOut += u.outputTokens;
    }
    if (sumIn > 0) deltaTokensIn = sumIn;
    if (sumOut > 0) deltaTokensOut = sumOut;
  }

  // If CLI didn't provide total_cost_usd, sum estimated per-model costs
  if (deltaCost === 0 && deltaModelUsage) {
    for (const u of Object.values(deltaModelUsage)) {
      deltaCost += u.costUsd;
    }
  }

  storage.addMessage(
    crypto.randomUUID(),
    threadId,
    "assistant",
    resultContent,
    deltaCost,
    deltaTokensIn,
    deltaTokensOut
  );

  if (deltaModelUsage) {
    storage.addModelUsage(threadId, deltaModelUsage);
  }

  trackCost(
    threadId,
    projectId,
    deltaCost,
    deltaTokensIn,
    deltaTokensOut,
    deltaModelUsage
  );

  sendToRenderer("agent:message", threadId, {
    type: "cost",
    costUsd: deltaCost,
    tokensIn: deltaTokensIn,
    tokensOut: deltaTokensOut,
    modelUsage: deltaModelUsage,
  } as StreamMessage);

  const isSuccess = message.subtype === "success";
  const finalStatus = isSuccess ? "completed" : "failed";
  storage.updateThreadStatus(threadId, finalStatus);

  sendToRenderer("agent:status", threadId, finalStatus);
  sendToRenderer("agent:message", threadId, {
    type: "status",
    status: finalStatus,
  } as StreamMessage);

  emitEvent({
    type: isSuccess ? "completed" : "failed",
    threadId,
    costUsd: deltaCost,
  });

  logger.info(
    "agent-orchestrator",
    `Agent ${threadId} finished: ${message.subtype} (delta $${deltaCost.toFixed(4)}, cumulative $${cumulativeCost.toFixed(4)})`
  );
}

async function runAgent(
  threadId: string,
  config: AgentLaunchConfig,
  events: AsyncGenerator<import("./claude-cli").CliEvent, void, undefined>
): Promise<void> {
  let receivedResult = false;
  const streamState = { lastSeenTextLength: 0, currentBlockIndex: 0, seenToolUseIds: new Set<string>() };

  try {
    for await (const message of events) {
      switch (message.type) {
        case "system": {
          if (message.subtype === "init" && message.session_id) {
            sessionRegistry.register(threadId, message.session_id);
            storage.updateThreadSession(threadId, message.session_id);
            logger.info(
              "agent-orchestrator",
              `Agent ${threadId} started with session ${message.session_id}`
            );
          }
          break;
        }

        case "assistant": {
          processAssistantEvent(threadId, message, streamState);
          break;
        }

        case "result": {
          receivedResult = true;
          processResultEvent(threadId, config.projectId, message);
          break;
        }
      }
    }

    if (!receivedResult) {
      logger.warn(
        "agent-orchestrator",
        `Agent ${threadId} ended without a result event`
      );
      storage.updateThreadStatus(threadId, "failed");
      sendToRenderer("agent:status", threadId, "failed");
      sendToRenderer("agent:error", threadId, {
        message: "Agent process ended without producing a result",
      });
      emitEvent({
        type: "failed",
        threadId,
        errorMessage: "Agent process ended without producing a result",
      });
    }
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    logger.error(
      "agent-orchestrator",
      `Agent ${threadId} error: ${errorMessage}`
    );
    storage.updateThreadStatus(threadId, "failed");
    sendToRenderer("agent:error", threadId, { message: errorMessage });
    sendToRenderer("agent:status", threadId, "failed");
    emitEvent({ type: "failed", threadId, errorMessage });
  } finally {
    activeAgents.delete(threadId);
    processQueue().catch((err) => {
      logger.error("agent-orchestrator", "Queue processing error", err);
    });
  }
}

// ── Public API ─────────────────────────────────────────────

export const agentOrchestrator = {
  setMainWindow(window: BrowserWindow): void {
    mainWindow = window;
  },

  async launch(config: AgentLaunchConfig): Promise<ThreadInfo> {
    // Check budget cap
    const project = storage.getProject(config.projectId);
    const budgetCap = project?.settings?.maxBudgetUsd;
    if (budgetCap) {
      const currentCost = projectCosts.get(config.projectId) ?? 0;
      if (currentCost >= budgetCap) {
        throw new Error(
          `Project budget cap reached ($${currentCost.toFixed(2)} / $${budgetCap.toFixed(2)})`
        );
      }
    }

    const threadId = crypto.randomUUID();

    if (canLaunch()) {
      return launchImmediate(config, threadId);
    }

    // Queue the agent
    logger.info(
      "agent-orchestrator",
      `Agent ${threadId} queued (${activeAgents.size}/${maxConcurrent} running)`
    );
    emitEvent({ type: "queued", threadId });

    return new Promise<ThreadInfo>((resolve, reject) => {
      agentQueue.push({ config, threadId, resolve, reject });
    });
  },

  async cancel(threadId: string): Promise<void> {
    // Check if it's in the queue
    const queueIndex = agentQueue.findIndex((q) => q.threadId === threadId);
    if (queueIndex !== -1) {
      const removed = agentQueue.splice(queueIndex, 1)[0];
      removed.reject(new Error("Cancelled while queued"));
      return;
    }

    const agent = activeAgents.get(threadId);
    if (agent) {
      agent.kill();
    }

    // Always update status, even if the agent is no longer tracked
    // (e.g. stale "running" threads from a previous app session)
    storage.updateThreadStatus(threadId, "failed");
    sendToRenderer("agent:status", threadId, "failed");
    emitEvent({ type: "cancelled", threadId });
    logger.info("agent-orchestrator", `Agent ${threadId} cancelled`);
  },

  async sendMessage(threadId: string, message: string, imagePaths?: string[]): Promise<void> {
    // Try in-memory registry first, then fall back to DB-persisted session ID
    let sessionId = sessionRegistry.getSessionId(threadId);
    if (!sessionId) {
      const thread = storage.getThread(threadId);
      sessionId = thread?.sessionId ?? null;
      if (sessionId) {
        sessionRegistry.register(threadId, sessionId);
      }
    }
    if (!sessionId) {
      throw new Error(`No session found for thread ${threadId}. The session may have been lost.`);
    }

    storage.addMessage(
      crypto.randomUUID(),
      threadId,
      "user",
      [{ type: "text", text: message }],
      null,
      null,
      null
    );

    const thread = storage.getThread(threadId);
    const projectData = thread
      ? storage.getProject(thread.projectId)
      : null;
    const cwd = thread?.worktreePath ?? projectData?.path ?? process.cwd();

    const appSettings = storage.getAppSettings();
    const { permissionMode: resolvedMode, allowedTools: resolvedTools } =
      resolvePermissionConfig(appSettings);
    const model = appSettings.defaultModel || undefined;

    const fullPrompt = buildPromptWithImages(message, imagePaths);

    const { events, kill } = spawnClaude({
      prompt: fullPrompt,
      cwd,
      resumeSessionId: sessionId,
      model,
      permissionMode: resolvedMode,
      allowedTools: resolvedTools,
      disallowedTools: DISALLOWED_TOOLS,
      appendSystemPrompt: NON_INTERACTIVE_SYSTEM_PROMPT,
      claudePath: getClaudeCliPath(),
    });

    const projectId = thread?.projectId ?? "";
    activeAgents.set(threadId, {
      threadId,
      projectId,
      kill,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      modelUsage: {},
    });
    storage.updateThreadStatus(threadId, "running");
    sendToRenderer("agent:status", threadId, "running");

    let receivedResult = false;
    const streamState = { lastSeenTextLength: 0, currentBlockIndex: 0, seenToolUseIds: new Set<string>() };

    try {
      for await (const msg of events) {
        if (msg.type === "system") {
          if (msg.subtype === "init" && msg.session_id) {
            sessionRegistry.register(threadId, msg.session_id);
            storage.updateThreadSession(threadId, msg.session_id);
          }
        } else if (msg.type === "assistant") {
          processAssistantEvent(threadId, msg, streamState);
        } else if (msg.type === "result") {
          receivedResult = true;
          processResultEvent(threadId, projectId, msg);
        }
      }

      if (!receivedResult) {
        logger.warn(
          "agent-orchestrator",
          `sendMessage for ${threadId} ended without a result event`
        );
        storage.updateThreadStatus(threadId, "failed");
        sendToRenderer("agent:status", threadId, "failed");
        sendToRenderer("agent:error", threadId, {
          message: "Agent process ended without producing a result",
        });
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      logger.error(
        "agent-orchestrator",
        `Send message failed: ${errorMessage}`
      );
      storage.updateThreadStatus(threadId, "failed");
      sendToRenderer("agent:error", threadId, { message: errorMessage });
      sendToRenderer("agent:status", threadId, "failed");
    } finally {
      activeAgents.delete(threadId);
      processQueue().catch((err) => {
        logger.error("agent-orchestrator", "Queue processing error", err);
      });
    }
  },

  shutdownAll(): void {
    for (const agent of activeAgents.values()) {
      try {
        agent.kill();
      } catch (err) {
        logger.warn(
          "agent-orchestrator",
          `Failed to kill agent ${agent.threadId}`,
          err
        );
      }
    }
    activeAgents.clear();
    logger.info("agent-orchestrator", "All agents shut down");
  },

  setMaxConcurrent(n: number): void {
    maxConcurrent = Math.max(1, n);
    logger.info("agent-orchestrator", `Max concurrent agents set to ${maxConcurrent}`);
    // Process queue in case new slots opened up
    processQueue().catch((err) => {
      logger.error("agent-orchestrator", "Queue processing error", err);
    });
  },

  getMaxConcurrent(): number {
    return maxConcurrent;
  },

  onEvent(eventType: AgentEventType, handler: EventHandler): void {
    const existing = eventHandlers.get(eventType) ?? [];
    existing.push(handler);
    eventHandlers.set(eventType, existing);
  },

  offEvent(eventType: AgentEventType, handler: EventHandler): void {
    const existing = eventHandlers.get(eventType) ?? [];
    eventHandlers.set(
      eventType,
      existing.filter((h) => h !== handler)
    );
  },

  getRunningThreadIds(): string[] {
    return Array.from(activeAgents.keys());
  },

  getRunningAgents(): ActiveAgent[] {
    return Array.from(activeAgents.values());
  },

  getQueuedCount(): number {
    return agentQueue.length;
  },

  isRunning(threadId: string): boolean {
    return activeAgents.has(threadId);
  },

  getProjectCost(projectId: string): number {
    return projectCosts.get(projectId) ?? 0;
  },

  getTotalCost(): number {
    let total = 0;
    for (const cost of projectCosts.values()) {
      total += cost;
    }
    return total;
  },

  getAgentCost(threadId: string): { costUsd: number; tokensIn: number; tokensOut: number; modelUsage: Record<string, ModelTokenUsage> } | null {
    const agent = activeAgents.get(threadId);
    if (!agent) return null;
    return {
      costUsd: agent.costUsd,
      tokensIn: agent.tokensIn,
      tokensOut: agent.tokensOut,
      modelUsage: { ...agent.modelUsage },
    };
  },

  getGlobalModelUsage(): Record<string, ModelTokenUsage> {
    // Deep copy to avoid mutation
    const copy: Record<string, ModelTokenUsage> = {};
    for (const [model, usage] of Object.entries(globalModelUsage)) {
      copy[model] = { ...usage };
    }
    return copy;
  },

  loadCostsFromDb(): void {
    try {
      const dbProjectCosts = storage.getAllProjectCosts();
      for (const [projectId, cost] of dbProjectCosts) {
        projectCosts.set(projectId, cost);
      }

      const dbModelUsage = storage.getGlobalModelUsageFromDb();
      mergeModelUsage(globalModelUsage, dbModelUsage);

      logger.info("agent-orchestrator", "Loaded historical costs from database");
    } catch (err) {
      logger.warn("agent-orchestrator", "Failed to load costs from database", err);
    }
  },
};
