import { query } from "@anthropic-ai/claude-agent-sdk";
import type { BrowserWindow } from "electron";
import { storage } from "./storage";
import { sessionRegistry } from "./session-registry";
import { logger } from "../utils/logger";
import type {
  AgentLaunchConfig,
  ThreadInfo,
  MessageContent,
  StreamMessage,
} from "../../src/types/ipc";

interface ActiveAgent {
  threadId: string;
  abortController: AbortController;
}

let mainWindow: BrowserWindow | null = null;
const activeAgents: Map<string, ActiveAgent> = new Map();

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

export const agentOrchestrator = {
  setMainWindow(window: BrowserWindow): void {
    mainWindow = window;
  },

  async launch(config: AgentLaunchConfig): Promise<ThreadInfo> {
    const threadId = crypto.randomUUID();
    const title = config.prompt.slice(0, 100);

    // Create thread in storage
    const thread = storage.createThread(
      threadId,
      config.projectId,
      title,
      null, // sessionId - will be set when we get it from SDK
      null, // worktreePath - will be set in Phase 2
      null  // worktreeBranch
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
    activeAgents.set(threadId, { threadId, abortController });

    this.runAgent(threadId, config, abortController.signal).catch((err) => {
      logger.error("agent-orchestrator", `Agent ${threadId} failed`, err);
    });

    return thread;
  },

  async runAgent(
    threadId: string,
    config: AgentLaunchConfig,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const project = storage.getProject(config.projectId);
      const cwd = project?.path ?? process.cwd();

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

            // Send to renderer for real-time updates
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
            // Forward partial streaming chunks for real-time text display
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
              { type: "text", text: "result" in message ? String(message.result) : "" },
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
      sendToRenderer("agent:error", threadId, {
        message: errorMessage,
      });
      sendToRenderer("agent:status", threadId, "failed");
    } finally {
      activeAgents.delete(threadId);
    }
  },

  async cancel(threadId: string): Promise<void> {
    const agent = activeAgents.get(threadId);
    if (agent) {
      agent.abortController.abort();
      storage.updateThreadStatus(threadId, "failed");
      sendToRenderer("agent:status", threadId, "failed");
      logger.info("agent-orchestrator", `Agent ${threadId} cancelled`);
    }
  },

  async sendMessage(threadId: string, message: string): Promise<void> {
    const sessionId = sessionRegistry.getSessionId(threadId);
    if (!sessionId) {
      throw new Error(`No session found for thread ${threadId}`);
    }

    // Store user message
    storage.addMessage(
      crypto.randomUUID(),
      threadId,
      "user",
      [{ type: "text", text: message }],
      null,
      null,
      null
    );

    const project = storage.getThread(threadId);
    const projectData = project
      ? storage.getProject(project.projectId)
      : null;
    const cwd = projectData?.path ?? process.cwd();

    // Resume the session with the new message
    const abortController = new AbortController();
    activeAgents.set(threadId, { threadId, abortController });
    storage.updateThreadStatus(threadId, "running");
    sendToRenderer("agent:status", threadId, "running");

    const config: AgentLaunchConfig = {
      projectId: project?.projectId ?? "",
      prompt: message,
    };

    // Run with resume
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

        // Same message handling as runAgent
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
            [{ type: "text", text: "result" in msg ? String(msg.result) : "" }],
            cost,
            msg.usage?.input_tokens ?? null,
            msg.usage?.output_tokens ?? null
          );
          const status = msg.subtype === "success" ? "completed" : "failed";
          storage.updateThreadStatus(threadId, status);
          sendToRenderer("agent:status", threadId, status);
        }
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      logger.error("agent-orchestrator", `Send message failed: ${errorMessage}`);
      storage.updateThreadStatus(threadId, "failed");
      sendToRenderer("agent:error", threadId, { message: errorMessage });
    } finally {
      activeAgents.delete(threadId);
    }
  },

  getRunningThreadIds(): string[] {
    return Array.from(activeAgents.keys());
  },

  isRunning(threadId: string): boolean {
    return activeAgents.has(threadId);
  },
};
