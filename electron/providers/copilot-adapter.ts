/**
 * GitHub Copilot Provider Adapter
 * Implements ProviderAdapter for GitHub Copilot API
 * Supports both /chat/completions and /responses endpoints
 */

import { logger } from "../utils/logger";
import type {
  ProviderAdapter,
  ProviderType,
  ModelInfo,
  AgentRunOptions,
  ToolCallMessage,
  ModelTokenUsage,
} from "./types";
import { COPILOT_MODELS, COPILOT_PREMIUM_REQUEST_USD } from "./types";
import { copilotAuth, getCopilotToken } from "./copilot-auth";
import { executeTool, TOOL_DEFINITIONS } from "./tool-executor";

// ── Constants ─────────────────────────────────────────────

const COPILOT_CHAT_URL = "https://api.githubcopilot.com/chat/completions";
const COPILOT_RESPONSES_URL = "https://api.githubcopilot.com/v1/responses";

// ── Types: Chat Completions ──────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: string | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Types: Responses API ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResponsesInputItem = Record<string, any>;

interface ResponsesEvent {
  type: string;
  // response.output_text.delta
  delta?: string;
  output_index?: number;
  content_index?: number;
  // response.output_item.added
  item?: {
    type: string;
    role?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  // response.function_call_arguments.done
  arguments?: string;
  call_id?: string;
  name?: string;
  // response.output_text.done
  text?: string;
  // response.completed / response.failed
  response?: {
    id?: string;
    status?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    error?: {
      message: string;
      code?: string;
    };
    output?: ResponsesOutputItem[];
  };
}

interface ResponsesOutputItem {
  type: string;
  id?: string;
  // message
  role?: string;
  content?: { type: string; text?: string }[];
  // function_call
  call_id?: string;
  name?: string;
  arguments?: string;
}

// ── Helpers ───────────────────────────────────────────────

function isResponsesModel(modelId: string): boolean {
  const model = COPILOT_MODELS.find((m) => m.id === modelId);
  return model?.responsesApi === true;
}

function buildCopilotHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "Editor-Version": "vscode/1.107.0",
    "Editor-Plugin-Version": "copilot-chat/0.35.0",
    "Copilot-Integration-Id": "vscode-chat",
    "x-github-api-version": "2025-04-01",
    "x-request-id": crypto.randomUUID(),
  };
}

/** Build tool definitions in /chat/completions format (nested) */
function buildChatTools() {
  return TOOL_DEFINITIONS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/** Build tool definitions in /responses format (flat, strict-compatible) */
function buildResponsesTools() {
  return TOOL_DEFINITIONS.map((tool) => {
    const schema = tool.inputSchema;
    const requiredSet = new Set(schema.required ?? []);
    const allPropertyKeys = Object.keys(schema.properties ?? {});

    // For strict mode: all properties must be in `required`, optional ones become nullable
    const strictProperties: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      if (requiredSet.has(key)) {
        strictProperties[key] = prop;
      } else {
        // Make optional properties nullable so strict mode accepts them
        const p = prop as Record<string, unknown>;
        strictProperties[key] = { ...p, type: [p.type as string, "null"] };
      }
    }

    return {
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: strictProperties,
        required: allPropertyKeys,
        additionalProperties: false,
      },
      strict: true,
    };
  });
}

/** Parse SSE lines from a buffer, returning parsed lines and remaining buffer */
function parseSseLines(buffer: string): { lines: string[]; remaining: string } {
  const split = buffer.split("\n");
  const remaining = split.pop() ?? "";
  const lines: string[] = [];
  for (const line of split) {
    if (line.startsWith("data: ")) {
      lines.push(line.slice(6).trim());
    }
  }
  return { lines, remaining };
}

// ── Copilot Adapter Implementation ────────────────────────

export class CopilotAdapter implements ProviderAdapter {
  readonly name: ProviderType = "copilot";
  readonly displayName = "GitHub Copilot";

  private abortController: AbortController | null = null;
  private copilotToken: string | null = null;
  private tokenExpiresAt = 0;

  async isAvailable(): Promise<boolean> {
    return copilotAuth.isAuthenticated();
  }

  async getModels(): Promise<ModelInfo[]> {
    return COPILOT_MODELS;
  }

  private async ensureCopilotToken(): Promise<string> {
    if (this.copilotToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.copilotToken;
    }

    const accessToken = copilotAuth.getStoredToken();
    if (!accessToken) {
      throw new Error("Not authenticated with GitHub. Please connect your account.");
    }

    const result = await getCopilotToken(accessToken);
    this.copilotToken = result.token;
    this.tokenExpiresAt = result.expires_at * 1000;

    return this.copilotToken;
  }

  async *runAgent(options: AgentRunOptions): AsyncGenerator<ToolCallMessage, void, undefined> {
    if (isResponsesModel(options.provider.model)) {
      yield* this.runAgentResponses(options);
    } else {
      yield* this.runAgentChat(options);
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ── /chat/completions path ──────────────────────────────

  private async *runAgentChat(options: AgentRunOptions): AsyncGenerator<ToolCallMessage, void, undefined> {
    const { prompt, cwd, provider, systemPrompt, permissionMode } = options;

    logger.info("copilot-adapter", `Starting chat agent with model ${provider.model}`);
    this.abortController = new AbortController();

    const messages: ChatMessage[] = [];
    messages.push({
      role: "system",
      content: systemPrompt ?? `You are a helpful coding assistant. You have access to tools to read, write, and edit files, run commands, and search the codebase. Use these tools to help the user with their request. Current working directory: ${cwd}`,
    });
    messages.push({ role: "user", content: prompt });

    const tools = buildChatTools();
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let continueLoop = true;
    let iterationCount = 0;
    const maxIterations = 50;

    while (continueLoop && iterationCount < maxIterations) {
      iterationCount++;

      try {
        const token = await this.ensureCopilotToken();

        const response = await fetch(COPILOT_CHAT_URL, {
          method: "POST",
          headers: buildCopilotHeaders(token),
          body: JSON.stringify({
            model: provider.model,
            messages,
            tools,
            stream: true,
            max_tokens: 16384,
          }),
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Copilot API error: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        let currentContent = "";
        const currentToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
        let finishReason: string | null = null;
        let blockIndex = 0;
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { lines, remaining } = parseSseLines(buffer);
          buffer = remaining;

          for (const data of lines) {
            if (data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data) as ChatCompletionChunk;
              const choice = chunk.choices[0];
              if (!choice) continue;

              if (choice.delta.content) {
                currentContent += choice.delta.content;
                yield { type: "text", text: choice.delta.content, isPartial: true, blockIndex };
              }

              if (choice.delta.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                  const existing = currentToolCalls.get(tc.index);
                  if (!existing) {
                    currentToolCalls.set(tc.index, {
                      id: tc.id ?? "",
                      name: tc.function?.name ?? "",
                      arguments: tc.function?.arguments ?? "",
                    });
                  } else {
                    if (tc.id) existing.id = tc.id;
                    if (tc.function?.name) existing.name = tc.function.name;
                    if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                  }
                }
              }

              if (chunk.usage) {
                totalTokensIn += chunk.usage.prompt_tokens;
                totalTokensOut += chunk.usage.completion_tokens;
              }

              finishReason = choice.finish_reason;
            } catch {
              // Ignore parse errors
            }
          }
        }

        logger.info("copilot-adapter", `Chat iteration ${iterationCount}: text=${currentContent.length}chars, toolCalls=${currentToolCalls.size}, finishReason=${finishReason}`);

        // Process tool calls
        if (finishReason === "tool_calls" && currentToolCalls.size > 0) {
          const toolCallsArray: ChatToolCall[] = [];
          for (const tc of currentToolCalls.values()) {
            toolCallsArray.push({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            });
          }

          messages.push({ role: "assistant", content: currentContent || "", tool_calls: toolCallsArray });

          for (const tc of currentToolCalls.values()) {
            blockIndex++;
            let toolInput: Record<string, unknown> = {};
            try { toolInput = JSON.parse(tc.arguments); } catch { /* ignore */ }

            yield { type: "tool_use", toolId: tc.id, toolName: tc.name, toolInput, blockIndex };

            const result = await executeTool(tc.name, toolInput, cwd, permissionMode);
            yield { type: "tool_result", toolId: tc.id, toolName: tc.name, toolOutput: result.output };

            messages.push({ role: "tool", content: result.output, tool_call_id: tc.id });
            blockIndex++;
          }

          continue;
        }

        continueLoop = false;
        if (currentContent) {
          messages.push({ role: "assistant", content: currentContent });
        }
      } catch (err) {
        if (this.abortController.signal.aborted) {
          yield { type: "status", status: "failed", errorMessage: "Request cancelled" };
          return;
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error("copilot-adapter", `Chat API error: ${errorMessage}`);
        yield { type: "error", errorMessage };
        yield { type: "status", status: "failed", errorMessage };
        return;
      }
    }

    yield* this.emitFinalCost(provider.model, totalTokensIn, totalTokensOut);
    this.abortController = null;
  }

  // ── /responses path ─────────────────────────────────────

  private async *runAgentResponses(options: AgentRunOptions): AsyncGenerator<ToolCallMessage, void, undefined> {
    const { prompt, cwd, provider, systemPrompt, permissionMode } = options;

    logger.info("copilot-adapter", `Starting responses agent with model ${provider.model}`);
    this.abortController = new AbortController();

    // Build input array in Responses API format
    const input: ResponsesInputItem[] = [];
    input.push({
      role: "user",
      content: [{ type: "input_text", text: prompt }],
    });

    const instructions = systemPrompt ?? `You are a helpful coding assistant. You have access to tools to read, write, and edit files, run commands, and search the codebase. Use these tools to help the user with their request. Current working directory: ${cwd}`;

    const tools = buildResponsesTools();
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let continueLoop = true;
    let iterationCount = 0;
    const maxIterations = 50;

    while (continueLoop && iterationCount < maxIterations) {
      iterationCount++;

      try {
        const token = await this.ensureCopilotToken();

        const response = await fetch(COPILOT_RESPONSES_URL, {
          method: "POST",
          headers: buildCopilotHeaders(token),
          body: JSON.stringify({
            model: provider.model,
            input,
            instructions,
            tools,
            stream: true,
            max_output_tokens: 16384,
            parallel_tool_calls: false,
            store: false,
          }),
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Copilot Responses API error: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        // Parse the SSE stream for Responses API events
        let currentText = "";
        const functionCalls: Map<number, { callId: string; name: string; arguments: string }> = new Map();
        let blockIndex = 0;
        let responseCompleted = false;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { lines, remaining } = parseSseLines(buffer);
          buffer = remaining;

          for (const data of lines) {
            if (data === "[DONE]") continue;

            let event: ResponsesEvent;
            try {
              event = JSON.parse(data) as ResponsesEvent;
            } catch {
              continue;
            }

            switch (event.type) {
              case "response.output_text.delta": {
                if (event.delta) {
                  currentText += event.delta;
                  yield { type: "text", text: event.delta, isPartial: true, blockIndex };
                }
                break;
              }

              case "response.output_item.added": {
                if (event.item?.type === "function_call" && event.output_index != null) {
                  functionCalls.set(event.output_index, {
                    callId: event.item.call_id ?? `call_${event.output_index}`,
                    name: event.item.name ?? "",
                    arguments: "",
                  });
                }
                break;
              }

              case "response.function_call_arguments.delta": {
                if (event.output_index != null && event.delta) {
                  const fc = functionCalls.get(event.output_index);
                  if (fc) fc.arguments += event.delta;
                }
                break;
              }

              case "response.function_call_arguments.done": {
                // Final arguments already accumulated via deltas
                if (event.output_index != null && event.arguments) {
                  const fc = functionCalls.get(event.output_index);
                  if (fc) fc.arguments = event.arguments;
                }
                break;
              }

              case "response.completed": {
                responseCompleted = true;
                if (event.response?.usage) {
                  totalTokensIn += event.response.usage.input_tokens;
                  totalTokensOut += event.response.usage.output_tokens;
                }
                // Fallback: extract function calls from response.output if not caught by stream events
                if (event.response?.output && functionCalls.size === 0) {
                  let idx = 0;
                  for (const item of event.response.output) {
                    if (item.type === "function_call" && item.name && item.call_id) {
                      functionCalls.set(idx, {
                        callId: item.call_id,
                        name: item.name,
                        arguments: item.arguments ?? "{}",
                      });
                      idx++;
                    }
                  }
                }
                break;
              }

              case "response.failed": {
                const errMsg = event.response?.error?.message ?? "Responses API failed";
                throw new Error(errMsg);
              }
            }
          }
        }

        logger.info("copilot-adapter", `Iteration ${iterationCount}: text=${currentText.length}chars, functionCalls=${functionCalls.size}, responseCompleted=${responseCompleted}`);

        // Process any function calls
        if (functionCalls.size > 0) {
          // Add assistant output items to the input history for next iteration
          if (currentText) {
            input.push({
              role: "assistant",
              content: [{ type: "output_text", text: currentText }],
            });
          }

          for (const fc of functionCalls.values()) {
            // Add function_call item to input
            input.push({
              type: "function_call",
              call_id: fc.callId,
              name: fc.name,
              arguments: fc.arguments,
            });

            blockIndex++;
            let toolInput: Record<string, unknown> = {};
            try { toolInput = JSON.parse(fc.arguments); } catch { /* ignore */ }

            yield { type: "tool_use", toolId: fc.callId, toolName: fc.name, toolInput, blockIndex };

            const result = await executeTool(fc.name, toolInput, cwd, permissionMode);
            yield { type: "tool_result", toolId: fc.callId, toolName: fc.name, toolOutput: result.output };

            // Add function_call_output item to input
            input.push({
              type: "function_call_output",
              call_id: fc.callId,
              output: result.output,
            });

            blockIndex++;
          }

          // Continue loop for next model response
          continue;
        }

        // No function calls — done
        continueLoop = false;
      } catch (err) {
        if (this.abortController.signal.aborted) {
          yield { type: "status", status: "failed", errorMessage: "Request cancelled" };
          return;
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error("copilot-adapter", `Responses API error: ${errorMessage}`);
        yield { type: "error", errorMessage };
        yield { type: "status", status: "failed", errorMessage };
        return;
      }
    }

    yield* this.emitFinalCost(provider.model, totalTokensIn, totalTokensOut);
    this.abortController = null;
  }

  // ── Shared helpers ──────────────────────────────────────

  private *emitFinalCost(
    model: string,
    tokensIn: number,
    tokensOut: number
  ): Generator<ToolCallMessage, void, undefined> {
    // Estimate cost from premium multiplier
    const modelDef = COPILOT_MODELS.find((m) => m.id === model);
    const multiplier = modelDef?.premiumMultiplier ?? 1;
    // Copilot charges per premium request ($0.04 per 1x multiplier)
    // Rough estimate: 1 request = 1 premium request * multiplier
    const estimatedCost = COPILOT_PREMIUM_REQUEST_USD * multiplier;

    const modelUsage: Record<string, ModelTokenUsage> = {
      [model]: {
        inputTokens: tokensIn,
        outputTokens: tokensOut,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: estimatedCost,
      },
    };

    yield {
      type: "cost",
      costUsd: estimatedCost,
      tokensIn,
      tokensOut,
      modelUsage,
    };

    yield {
      type: "status",
      status: "completed",
    };
  }
}

// ── Singleton Export ──────────────────────────────────────

export const copilotAdapter = new CopilotAdapter();
