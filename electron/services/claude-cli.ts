import { spawn, execFileSync, ChildProcess } from "child_process";
import { logger } from "../utils/logger";

// ── Types ──────────────────────────────────────────────────

export interface CliModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

export interface CliEvent {
  type: "system" | "assistant" | "result";
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: {
    model?: string;
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  content_block?: {
    type: string;
    text?: string;
  };
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, CliModelUsage>;
  // Allow other fields from NDJSON
  [key: string]: unknown;
}

export interface SpawnClaudeOptions {
  prompt: string;
  cwd: string;
  model?: string;
  resumeSessionId?: string;
  permissionMode?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  appendSystemPrompt?: string;
  claudePath?: string;
}

export interface SpawnClaudeResult {
  events: AsyncGenerator<CliEvent, void, undefined>;
  kill: () => void;
}

// ── Implementation ─────────────────────────────────────────

export function spawnClaude(options: SpawnClaudeOptions): SpawnClaudeResult {
  const {
    prompt,
    cwd,
    model,
    resumeSessionId,
    permissionMode,
    allowedTools,
    disallowedTools,
    appendSystemPrompt,
    claudePath,
  } = options;

  const claudeBin = claudePath ?? "claude";

  // Build argument list
  // --verbose is required when combining -p with --output-format stream-json
  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  if (model) {
    args.push("--model", model);
  }
  if (permissionMode) {
    args.push("--permission-mode", permissionMode);
  }
  if (allowedTools && allowedTools.length > 0) {
    args.push("--allowedTools", ...allowedTools);
  }
  if (disallowedTools && disallowedTools.length > 0) {
    args.push("--disallowedTools", ...disallowedTools);
  }
  if (appendSystemPrompt) {
    args.push("--append-system-prompt", appendSystemPrompt);
  }

  logger.info("claude-cli", `Spawning: ${claudeBin} ${args.join(" ")}`);

  let child: ChildProcess | null = null;
  let killed = false;

  const kill = (): void => {
    if (killed || !child || child.exitCode !== null) return;
    killed = true;

    try {
      if (process.platform === "win32" && child.pid) {
        // Use execFileSync to avoid shell injection - pid is always a number from child.pid
        execFileSync("taskkill", ["/T", "/F", "/pid", String(child.pid)], {
          stdio: "ignore",
        });
      } else if (child.pid) {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      // Process may already be gone
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  };

  async function* generate(): AsyncGenerator<CliEvent, void, undefined> {
    // Track spawn errors separately since they happen asynchronously
    let spawnError: Error | null = null;

    child = spawn(claudeBin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    const stderrChunks: string[] = [];

    child.on("error", (err: Error) => {
      spawnError = err;
      logger.error("claude-cli", `Spawn error: ${err.message}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrChunks.push(text);
      logger.warn("claude-cli", `stderr: ${text.trim()}`);
    });

    // Create a line-based reader from stdout
    const lines = readLines(child.stdout!);
    let yieldedAnyEvent = false;

    try {
      for await (const line of lines) {
        if (killed) break;

        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as CliEvent;
          yieldedAnyEvent = true;
          yield event;
        } catch {
          logger.warn("claude-cli", `Non-JSON line: ${trimmed.slice(0, 200)}`);
        }
      }
    } finally {
      // Wait for process to exit if it hasn't already
      if (child && child.exitCode === null && !killed) {
        await new Promise<void>((resolve) => {
          child!.on("exit", () => resolve());
          // Safety timeout
          setTimeout(() => resolve(), 5000);
        });
      }

      const exitCode = child?.exitCode ?? null;
      const stderr = stderrChunks.join("");

      // Throw on spawn errors (binary not found, permission denied, etc.)
      // Note: spawnError is assigned in an async event handler, so TS can't track it
      const spawnErr = spawnError as Error | null;
      if (spawnErr) {
        throw new Error(`Failed to start Claude CLI: ${spawnErr.message}`);
      }

      // Throw on non-zero exit codes so callers can handle the failure
      if (exitCode !== null && exitCode !== 0 && !killed) {
        const detail = stderr.slice(0, 500) || `exit code ${exitCode}`;
        logger.error("claude-cli", `Process exited with code ${exitCode}: ${detail}`);
        throw new Error(`Claude CLI exited with code ${exitCode}: ${detail}`);
      }

      // If process exited normally but produced no events, something went wrong
      if (!yieldedAnyEvent && !killed && exitCode === 0) {
        logger.warn("claude-cli", "Process exited without producing any events");
      }
    }
  }

  return { events: generate(), kill };
}

// ── Line splitter ──────────────────────────────────────────

async function* readLines(
  stream: NodeJS.ReadableStream
): AsyncGenerator<string, void, undefined> {
  let buffer = "";

  for await (const chunk of stream) {
    buffer += chunk.toString();
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      yield part;
    }
  }

  // Yield any remaining content
  if (buffer.trim()) {
    yield buffer;
  }
}
