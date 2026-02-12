/**
 * Claude CLI Provider Adapter
 * Wraps the existing claude-cli.ts to implement ProviderAdapter interface
 */

import { spawnClaude, type CliEvent, type SpawnClaudeOptions } from "../services/claude-cli";
import { storage } from "../services/storage";
import { logger } from "../utils/logger";
import type {
  ProviderAdapter,
  ProviderType,
  ModelInfo,
  AgentRunOptions,
  ToolCallMessage,
  ModelTokenUsage,
} from "./types";
import { CLAUDE_MODELS } from "./types";

// ── Constants ─────────────────────────────────────────────

const DEFAULT_TOOLS = [
  "Read", "Edit", "Write", "Bash",
  "Glob", "Grep", "WebSearch", "WebFetch",
];

const DISALLOWED_TOOLS = ["EnterPlanMode"];

const NON_INTERACTIVE_SYSTEM_PROMPT =
  "You are running in non-interactive print mode. " +
  "DO NOT enter plan mode. Implement all requested changes directly. " +
  "Write code, create files, and make edits immediately without asking for confirmation.";

// ── Helper Functions ──────────────────────────────────────

function getClaudeCliPath(): string | undefined {
  try {
    const settings = storage.getAppSettings();
    return settings.claudeCliPath ?? undefined;
  } catch {
    return undefined;
  }
}

function resolvePermissionMode(mode: AgentRunOptions["permissionMode"]): string {
  switch (mode) {
    case "full":
      return "bypassPermissions";
    case "ask":
      return "acceptEdits";
    case "acceptEdits":
    default:
      return "bypassPermissions";
  }
}

function buildPromptWithImages(prompt: string, imagePaths?: string[]): string {
  if (!imagePaths || imagePaths.length === 0) return prompt;
  const imageRefs = imagePaths
    .map((p) => p.replace(/\\/g, "/"))
    .map((p) => `[Image: ${p}]`)
    .join("\n");
  return `${imageRefs}\n\n${prompt}`;
}

// ── CliEvent to ToolCallMessage Conversion ────────────────

interface StreamState {
  lastSeenTextLength: number;
  currentBlockIndex: number;
  seenToolUseIds: Set<string>;
}

function* convertCliEventToMessages(
  event: CliEvent,
  state: StreamState
): Generator<ToolCallMessage, void, undefined> {
  switch (event.type) {
    case "system": {
      if (event.subtype === "init" && event.session_id) {
        yield {
          type: "system",
          status: "init",
          sessionId: event.session_id,
        };
      }
      break;
    }

    case "assistant": {
      // Handle content_block partials (from --include-partial-messages)
      if (event.content_block) {
        if (event.content_block.type === "text" && event.content_block.text) {
          const fullText = event.content_block.text;
          const delta = fullText.slice(state.lastSeenTextLength);
          state.lastSeenTextLength = fullText.length;

          if (delta) {
            yield {
              type: "text",
              text: delta,
              isPartial: true,
              blockIndex: state.currentBlockIndex,
            };
          }
        }

        // Check for tool_use in content_block
        if (event.content_block.type === "tool_use") {
          const toolBlock = event.content_block as unknown as {
            type: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
          };
          if (toolBlock.name) {
            const dedupeKey = toolBlock.id ?? `${toolBlock.name}-${JSON.stringify(toolBlock.input)}`;
            if (!state.seenToolUseIds.has(dedupeKey)) {
              state.seenToolUseIds.add(dedupeKey);
              state.currentBlockIndex++;
              state.lastSeenTextLength = 0;

              yield {
                type: "tool_use",
                toolId: toolBlock.id,
                toolName: toolBlock.name,
                toolInput: toolBlock.input ?? {},
                blockIndex: state.currentBlockIndex,
              };

              state.currentBlockIndex++;
            }
          }
        }
      }

      // Handle full message.content snapshots
      const apiMessage = event.message;
      if (apiMessage && Array.isArray(apiMessage.content)) {
        for (const block of apiMessage.content) {
          if (block.type === "text") {
            const fullText = block.text ?? "";
            const delta = fullText.slice(state.lastSeenTextLength);
            state.lastSeenTextLength = fullText.length;

            if (delta) {
              yield {
                type: "text",
                text: delta,
                isPartial: true,
                blockIndex: state.currentBlockIndex,
              };
            }
          } else if (block.type === "tool_use") {
            const toolId = (block as Record<string, unknown>).id as string | undefined;
            const dedupeKey = toolId ?? `${block.name}-${JSON.stringify(block.input)}`;
            if (!state.seenToolUseIds.has(dedupeKey)) {
              state.seenToolUseIds.add(dedupeKey);
              state.currentBlockIndex++;
              state.lastSeenTextLength = 0;

              yield {
                type: "tool_use",
                toolId,
                toolName: block.name,
                toolInput: block.input as Record<string, unknown>,
                blockIndex: state.currentBlockIndex,
              };

              state.currentBlockIndex++;
            }
          }
        }
      }
      break;
    }

    case "result": {
      // Parse model usage
      const modelUsage: Record<string, ModelTokenUsage> | undefined = event.modelUsage
        ? Object.fromEntries(
            Object.entries(event.modelUsage).map(([model, u]) => [
              model,
              {
                inputTokens: u.inputTokens ?? 0,
                outputTokens: u.outputTokens ?? 0,
                cacheReadInputTokens: u.cacheReadInputTokens ?? 0,
                cacheCreationInputTokens: u.cacheCreationInputTokens ?? 0,
                costUsd: u.costUSD ?? 0,
              },
            ])
          )
        : undefined;

      yield {
        type: "cost",
        costUsd: event.total_cost_usd ?? 0,
        tokensIn: event.usage?.input_tokens ?? 0,
        tokensOut: event.usage?.output_tokens ?? 0,
        modelUsage,
      };

      const isSuccess = event.subtype === "success";
      yield {
        type: "status",
        status: isSuccess ? "completed" : "failed",
        text: event.result,
      };
      break;
    }
  }
}

// ── Claude Adapter Implementation ─────────────────────────

export class ClaudeAdapter implements ProviderAdapter {
  readonly name: ProviderType = "claude";
  readonly displayName = "Claude CLI";

  private killFn: (() => void) | null = null;

  async isAvailable(): Promise<boolean> {
    // Check if Claude CLI is accessible
    const cliPath = getClaudeCliPath() ?? "claude";
    try {
      const { execFileSync } = await import("child_process");
      execFileSync(cliPath, ["--version"], { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    return CLAUDE_MODELS;
  }

  async *runAgent(options: AgentRunOptions): AsyncGenerator<ToolCallMessage, void, undefined> {
    const {
      prompt,
      cwd,
      provider,
      systemPrompt,
      permissionMode,
      resumeSessionId,
      imagePaths,
      allowedTools,
      disallowedTools,
    } = options;

    const spawnOptions: SpawnClaudeOptions = {
      prompt: buildPromptWithImages(prompt, imagePaths),
      cwd,
      model: provider.model,
      resumeSessionId,
      permissionMode: resolvePermissionMode(permissionMode),
      allowedTools: allowedTools ?? DEFAULT_TOOLS,
      disallowedTools: disallowedTools ?? DISALLOWED_TOOLS,
      appendSystemPrompt: systemPrompt ?? NON_INTERACTIVE_SYSTEM_PROMPT,
      claudePath: getClaudeCliPath(),
    };

    logger.info("claude-adapter", `Starting agent with model ${provider.model}`);

    const { events, kill } = spawnClaude(spawnOptions);
    this.killFn = kill;

    const streamState: StreamState = {
      lastSeenTextLength: 0,
      currentBlockIndex: 0,
      seenToolUseIds: new Set(),
    };

    try {
      for await (const cliEvent of events) {
        for (const message of convertCliEventToMessages(cliEvent, streamState)) {
          yield message;
        }
      }
    } finally {
      this.killFn = null;
    }
  }

  cancel(): void {
    if (this.killFn) {
      this.killFn();
      this.killFn = null;
    }
  }
}

// ── Singleton Export ──────────────────────────────────────

export const claudeAdapter = new ClaudeAdapter();
