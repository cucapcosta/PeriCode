import { query } from "@anthropic-ai/claude-agent-sdk";
import type { BrowserWindow } from "electron";
import { storage } from "./storage";
import { sessionRegistry } from "./session-registry";
import { worktreeManager } from "./worktree-manager";
import { logger } from "../utils/logger";
import type {
  AgentLaunchConfig,
  ThreadInfo,
  MessageContent,
  StreamMessage,
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
}

type EventHandler = (event: AgentEvent) => void;

interface ActiveAgent {
  threadId: string;
  projectId: string;
  abortController: AbortController;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
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

function trackCost(
  threadId: string,
  projectId: string,
  costUsd: number,
  tokensIn: number,
  tokensOut: number
): void {
  const agent = activeAgents.get(threadId);
  if (agent) {
    agent.costUsd += costUsd;
    agent.tokensIn += tokensIn;
    agent.tokensOut += tokensOut;
  }

  const currentProjectCost = projectCosts.get(projectId) ?? 0;
  projectCosts.set(projectId, currentProjectCost + costUsd);

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
  const abortController = new AbortController();
  activeAgents.set(threadId, {
    threadId,
    projectId: config.projectId,
    abortController,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
  });

  emitEvent({ type: "launched", threadId });

  runAgent(threadId, config, abortController.signal, worktreePath).catch(
    (err) => {
      logger.error("agent-orchestrator", `Agent ${threadId} failed`, err);
    }
  );

  return thread;
}

async function runAgent(
  threadId: string,
  config: AgentLaunchConfig,
  signal: AbortSignal,
  worktreePath: string | null
): Promise<void> {
  try {
    const project = storage.getProject(config.projectId);
    // Use worktree path if available, otherwise project path
    const cwd = worktreePath ?? project?.path ?? process.cwd();

    const agentQuery = query({
      prompt: config.prompt,
      options: {
        model: config.model,
        cwd,
        permissionMode: "acceptEdits",
        allowedTools: [
          "Read",
          "Edit",
          "Write",
          "Bash",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
        ],
        includePartialMessages: true,
      },
    });

    for await (const message of agentQuery) {
      if (signal.aborted) {
        await agentQuery.interrupt();
        break;
      }

      switch (message.type) {
        case "system": {
          if (message.subtype === "init") {
            const sessionId = message.session_id;
            sessionRegistry.register(threadId, sessionId);
            storage.updateThreadSession(threadId, sessionId);
            logger.info(
              "agent-orchestrator",
              `Agent ${threadId} started with session ${sessionId}`
            );
          }
          break;
        }

        case "assistant": {
          const contentBlocks: MessageContent[] = [];
          const apiMessage = message.message;

          if (apiMessage && Array.isArray(apiMessage.content)) {
            for (const block of apiMessage.content) {
              if (block.type === "text") {
                contentBlocks.push({ type: "text", text: block.text });
              } else if (block.type === "tool_use") {
                contentBlocks.push({
                  type: "tool_use",
                  toolName: block.name,
                  toolInput: block.input as Record<string, unknown>,
                });
              }
            }
          }

          if (contentBlocks.length > 0) {
            storage.addMessage(
              crypto.randomUUID(),
              threadId,
              "assistant",
              contentBlocks,
              null,
              null,
              null
            );
          }

          for (const block of contentBlocks) {
            const streamMsg: StreamMessage = {
              type: block.type === "text" ? "text" : "tool_use",
              text: block.text,
              toolName: block.toolName,
              toolInput: block.toolInput,
            };
            sendToRenderer("agent:message", threadId, streamMsg);
          }
          break;
        }

        case "stream_event": {
          const event = message.event;
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const streamMsg: StreamMessage = {
              type: "text",
              text: event.delta.text,
            };
            sendToRenderer("agent:message", threadId, streamMsg);
          }
          break;
        }

        case "result": {
          const resultCost = message.total_cost_usd ?? 0;
          const resultContent: MessageContent[] = [
            {
              type: "text",
              text: "result" in message ? String(message.result) : "",
            },
          ];

          storage.addMessage(
            crypto.randomUUID(),
            threadId,
            "assistant",
            resultContent,
            resultCost,
            message.usage?.input_tokens ?? null,
            message.usage?.output_tokens ?? null
          );

          // Track budget
          trackCost(
            threadId,
            config.projectId,
            resultCost,
            message.usage?.input_tokens ?? 0,
            message.usage?.output_tokens ?? 0
          );

          const costMsg: StreamMessage = {
            type: "cost",
            costUsd: resultCost,
            tokensIn: message.usage?.input_tokens,
            tokensOut: message.usage?.output_tokens,
          };
          sendToRenderer("agent:message", threadId, costMsg);

          const isSuccess = message.subtype === "success";
          const finalStatus = isSuccess ? "completed" : "failed";
          storage.updateThreadStatus(threadId, finalStatus);

          const statusMsg: StreamMessage = {
            type: "status",
            status: finalStatus,
          };
          sendToRenderer("agent:status", threadId, finalStatus);
          sendToRenderer("agent:message", threadId, statusMsg);

          emitEvent({
            type: isSuccess ? "completed" : "failed",
            threadId,
            costUsd: resultCost,
          });

          logger.info(
            "agent-orchestrator",
            `Agent ${threadId} finished: ${message.subtype} ($${resultCost.toFixed(4)})`
          );
          break;
        }
      }
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
    emitEvent({ type: "failed", threadId });
  } finally {
    activeAgents.delete(threadId);
    // Process queued agents now that a slot is free
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
      agent.abortController.abort();
      storage.updateThreadStatus(threadId, "failed");
      sendToRenderer("agent:status", threadId, "failed");
      emitEvent({ type: "cancelled", threadId });
      logger.info("agent-orchestrator", `Agent ${threadId} cancelled`);
    }
  },

  async sendMessage(threadId: string, message: string): Promise<void> {
    const sessionId = sessionRegistry.getSessionId(threadId);
    if (!sessionId) {
      throw new Error(`No session found for thread ${threadId}`);
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

    const abortController = new AbortController();
    activeAgents.set(threadId, {
      threadId,
      projectId: thread?.projectId ?? "",
      abortController,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
    });
    storage.updateThreadStatus(threadId, "running");
    sendToRenderer("agent:status", threadId, "running");

    try {
      const agentQuery = query({
        prompt: message,
        options: {
          resume: sessionId,
          cwd,
          permissionMode: "acceptEdits",
          includePartialMessages: true,
        },
      });

      for await (const msg of agentQuery) {
        if (abortController.signal.aborted) {
          await agentQuery.interrupt();
          break;
        }

        if (msg.type === "assistant") {
          const contentBlocks: MessageContent[] = [];
          if (msg.message && Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (block.type === "text") {
                contentBlocks.push({ type: "text", text: block.text });
              } else if (block.type === "tool_use") {
                contentBlocks.push({
                  type: "tool_use",
                  toolName: block.name,
                  toolInput: block.input as Record<string, unknown>,
                });
              }
            }
          }
          if (contentBlocks.length > 0) {
            storage.addMessage(
              crypto.randomUUID(),
              threadId,
              "assistant",
              contentBlocks,
              null,
              null,
              null
            );
            for (const block of contentBlocks) {
              sendToRenderer("agent:message", threadId, {
                type: block.type === "text" ? "text" : "tool_use",
                text: block.text,
                toolName: block.toolName,
                toolInput: block.toolInput,
              } as StreamMessage);
            }
          }
        } else if (msg.type === "stream_event") {
          const event = msg.event;
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            sendToRenderer("agent:message", threadId, {
              type: "text",
              text: event.delta.text,
            } as StreamMessage);
          }
        } else if (msg.type === "result") {
          const cost = msg.total_cost_usd ?? 0;
          storage.addMessage(
            crypto.randomUUID(),
            threadId,
            "assistant",
            [
              {
                type: "text",
                text: "result" in msg ? String(msg.result) : "",
              },
            ],
            cost,
            msg.usage?.input_tokens ?? null,
            msg.usage?.output_tokens ?? null
          );

          trackCost(
            threadId,
            thread?.projectId ?? "",
            cost,
            msg.usage?.input_tokens ?? 0,
            msg.usage?.output_tokens ?? 0
          );

          const status = msg.subtype === "success" ? "completed" : "failed";
          storage.updateThreadStatus(threadId, status);
          sendToRenderer("agent:status", threadId, status);
        }
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
    } finally {
      activeAgents.delete(threadId);
      processQueue().catch((err) => {
        logger.error("agent-orchestrator", "Queue processing error", err);
      });
    }
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

  getAgentCost(threadId: string): { costUsd: number; tokensIn: number; tokensOut: number } | null {
    const agent = activeAgents.get(threadId);
    if (!agent) return null;
    return {
      costUsd: agent.costUsd,
      tokensIn: agent.tokensIn,
      tokensOut: agent.tokensOut,
    };
  },
};
