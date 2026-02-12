/**
 * Tool Executor
 * Executes tools for providers that don't have built-in tool support (e.g., Copilot)
 */

import { logger } from "../utils/logger";
import type { PermissionMode } from "./types";
import {
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool,
} from "./tools";

// ── Types ─────────────────────────────────────────────────

export interface ToolExecutionResult {
  output: string;
  success: boolean;
  requiresPermission: boolean;
}

export type ToolInput = Record<string, unknown>;

// Tools that modify files or system state
const WRITE_TOOLS = ["Write", "Edit", "Bash"];

// ── Permission Check ──────────────────────────────────────

function requiresPermission(
  toolName: string,
  permissionMode: PermissionMode
): boolean {
  if (permissionMode === "full") {
    return false; // Bypass all permissions
  }

  if (permissionMode === "acceptEdits") {
    // Only require permission for Bash commands
    return toolName === "Bash";
  }

  // "ask" mode - require permission for all write operations
  return WRITE_TOOLS.includes(toolName);
}

// ── Tool Executor ─────────────────────────────────────────

export async function executeTool(
  toolName: string,
  toolInput: ToolInput,
  cwd: string,
  permissionMode: PermissionMode = "acceptEdits"
): Promise<ToolExecutionResult> {
  const needsPermission = requiresPermission(toolName, permissionMode);

  // For now, we execute all tools directly
  // In the future, permission requests should go through IPC to the renderer
  if (needsPermission && permissionMode === "ask") {
    logger.warn("tool-executor", `Tool ${toolName} requires permission but IPC not implemented yet`);
  }

  try {
    const output = await executeToolImpl(toolName, toolInput, cwd);
    return {
      output,
      success: true,
      requiresPermission: needsPermission,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("tool-executor", `Tool ${toolName} failed: ${errorMessage}`);
    return {
      output: `Error: ${errorMessage}`,
      success: false,
      requiresPermission: needsPermission,
    };
  }
}

async function executeToolImpl(
  toolName: string,
  toolInput: ToolInput,
  cwd: string
): Promise<string> {
  switch (toolName) {
    case "Read": {
      const result = readTool(
        {
          file_path: toolInput.file_path as string,
          offset: toolInput.offset as number | undefined,
          limit: toolInput.limit as number | undefined,
        },
        cwd
      );
      return result.content;
    }

    case "Write": {
      const result = writeTool(
        {
          file_path: toolInput.file_path as string,
          content: toolInput.content as string,
        },
        cwd
      );
      return `File written successfully (${result.bytesWritten} bytes)`;
    }

    case "Edit": {
      const result = editTool(
        {
          file_path: toolInput.file_path as string,
          old_string: toolInput.old_string as string,
          new_string: toolInput.new_string as string,
          replace_all: toolInput.replace_all as boolean | undefined,
        },
        cwd
      );
      return `Replaced ${result.replacements} occurrence(s)`;
    }

    case "Bash": {
      const result = await bashTool(
        {
          command: toolInput.command as string,
          timeout: toolInput.timeout as number | undefined,
        },
        cwd
      );
      const output = result.stdout + (result.stderr ? `\nStderr: ${result.stderr}` : "");
      return `Exit code: ${result.exitCode}\n${output}`;
    }

    case "Glob": {
      const result = globTool(
        {
          pattern: toolInput.pattern as string,
          path: toolInput.path as string | undefined,
        },
        cwd
      );
      return result.files.join("\n") || "No files found";
    }

    case "Grep": {
      const result = grepTool(
        {
          pattern: toolInput.pattern as string,
          path: toolInput.path as string | undefined,
          glob: toolInput.glob as string | undefined,
          context: toolInput.context as number | undefined,
          output_mode: toolInput.output_mode as "content" | "files_with_matches" | "count" | undefined,
        },
        cwd
      );

      if (result.matches.length === 0) {
        return "No matches found";
      }

      const outputMode = toolInput.output_mode ?? "files_with_matches";
      if (outputMode === "files_with_matches") {
        return result.matches.map((m) => m.file).join("\n");
      } else if (outputMode === "count") {
        return `${result.matchCount} matches in ${result.fileCount} files`;
      } else {
        return result.matches
          .map((m) => `${m.file}:${m.line}: ${m.content}`)
          .join("\n");
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── Tool Definitions for API ──────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "Read",
    description: "Read the contents of a file",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "The path to the file to read" },
        offset: { type: "number", description: "Line number to start reading from (0-indexed)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Write",
    description: "Write content to a file, creating it if it doesn't exist",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "The path to the file to write" },
        content: { type: "string", description: "The content to write to the file" },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "Edit",
    description: "Search and replace text in a file",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "The path to the file to edit" },
        old_string: { type: "string", description: "The text to search for" },
        new_string: { type: "string", description: "The text to replace with" },
        replace_all: { type: "boolean", description: "Replace all occurrences (default: false)" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "Bash",
    description: "Execute a shell command",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 120000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The glob pattern (e.g., '**/*.ts')" },
        path: { type: "string", description: "Base directory to search in" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description: "Search for text in files using regex",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The regex pattern to search for" },
        path: { type: "string", description: "File or directory to search in" },
        glob: { type: "string", description: "Glob pattern to filter files (e.g., '*.ts')" },
        context: { type: "number", description: "Number of context lines before and after match" },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description: "Output mode (default: files_with_matches)",
        },
      },
      required: ["pattern"],
    },
  },
];
