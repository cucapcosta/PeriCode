import React, { useState } from "react";
import { ipc } from "@/lib/ipc-client";

interface ToolUseBlockProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
}

const TOOL_LABELS: Record<string, string> = {
  Edit: "Edit File",
  Write: "Write File",
  Read: "Read File",
  Bash: "Run Command",
  Glob: "Find Files",
  Grep: "Search Content",
  WebSearch: "Web Search",
  WebFetch: "Fetch URL",
  TodoWrite: "Update Todos",
  Task: "Sub-Agent",
  NotebookEdit: "Edit Notebook",
};

const TOOL_COLORS: Record<string, string> = {
  Edit: "border-yellow-500/40 bg-yellow-500/5",
  Write: "border-green-500/40 bg-green-500/5",
  Read: "border-blue-500/40 bg-blue-500/5",
  Bash: "border-orange-500/40 bg-orange-500/5",
  Glob: "border-cyan-500/40 bg-cyan-500/5",
  Grep: "border-cyan-500/40 bg-cyan-500/5",
  WebSearch: "border-purple-500/40 bg-purple-500/5",
  WebFetch: "border-purple-500/40 bg-purple-500/5",
};

const TOOL_DOT_COLORS: Record<string, string> = {
  Edit: "bg-yellow-400",
  Write: "bg-green-400",
  Read: "bg-blue-400",
  Bash: "bg-orange-400",
  Glob: "bg-cyan-400",
  Grep: "bg-cyan-400",
  WebSearch: "bg-purple-400",
  WebFetch: "bg-purple-400",
};

function extractFilePath(input: Record<string, unknown>): string | null {
  return (input.file_path as string) ?? (input.path as string) ?? null;
}

function shortenPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return parts.join("/");
  return ".../" + parts.slice(-3).join("/");
}

function formatCode(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

export const ToolUseBlock: React.FC<ToolUseBlockProps> = ({ toolName, toolInput }) => {
  const [expanded, setExpanded] = useState(false);
  const input = toolInput ?? {};
  const label = TOOL_LABELS[toolName] ?? toolName;
  const colorClass = TOOL_COLORS[toolName] ?? "border-muted-foreground/30 bg-muted/30";
  const dotColor = TOOL_DOT_COLORS[toolName] ?? "bg-muted-foreground";

  const filePath = extractFilePath(input);
  const hasFile = filePath && ["Edit", "Write", "Read", "NotebookEdit"].includes(toolName);

  const openInVSCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filePath) {
      ipc.invoke("worktree:openInVSCode", filePath).catch(console.error);
    }
  };

  const renderDetail = () => {
    switch (toolName) {
      case "Edit": {
        const oldStr = input.old_string as string | undefined;
        const newStr = input.new_string as string | undefined;
        return (
          <div className="mt-2 space-y-2">
            {filePath && (
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {filePath}
              </div>
            )}
            {oldStr && (
              <div className="rounded bg-red-500/8 border border-red-500/20 p-2 overflow-x-auto">
                <pre className="text-[11px] font-mono text-red-300 whitespace-pre-wrap break-all">{oldStr}</pre>
              </div>
            )}
            {newStr && (
              <div className="rounded bg-green-500/8 border border-green-500/20 p-2 overflow-x-auto">
                <pre className="text-[11px] font-mono text-green-300 whitespace-pre-wrap break-all">{newStr}</pre>
              </div>
            )}
          </div>
        );
      }

      case "Write": {
        const content = input.content as string | undefined;
        return (
          <div className="mt-2 space-y-2">
            {filePath && (
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {filePath}
              </div>
            )}
            {content && (
              <div className="rounded bg-green-500/8 border border-green-500/20 p-2 overflow-x-auto max-h-48 overflow-y-auto">
                <pre className="text-[11px] font-mono text-green-300 whitespace-pre-wrap break-all">
                  {content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content}
                </pre>
              </div>
            )}
          </div>
        );
      }

      case "Read": {
        return filePath ? (
          <div className="mt-2 text-[11px] text-muted-foreground font-mono truncate">
            {filePath}
          </div>
        ) : null;
      }

      case "Bash": {
        const command = input.command as string | undefined;
        const description = input.description as string | undefined;
        return (
          <div className="mt-2 space-y-1">
            {description && (
              <div className="text-[11px] text-muted-foreground">{description}</div>
            )}
            {command && (
              <div className="rounded bg-background/80 border border-border p-2 overflow-x-auto">
                <pre className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-all">$ {command}</pre>
              </div>
            )}
          </div>
        );
      }

      case "Grep": {
        const pattern = input.pattern as string | undefined;
        const path = (input.path as string) ?? ".";
        const glob = input.glob as string | undefined;
        return (
          <div className="mt-2">
            <div className="rounded bg-background/80 border border-border p-2 overflow-x-auto">
              <pre className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-all">
                grep {pattern ? `"${pattern}"` : ""}{glob ? ` --glob=${glob}` : ""} {shortenPath(path)}
              </pre>
            </div>
          </div>
        );
      }

      case "Glob": {
        const pattern = input.pattern as string | undefined;
        const path = input.path as string | undefined;
        return (
          <div className="mt-2">
            <div className="rounded bg-background/80 border border-border p-2">
              <pre className="text-[11px] font-mono text-foreground whitespace-pre-wrap break-all">
                {pattern}{path ? ` in ${shortenPath(path)}` : ""}
              </pre>
            </div>
          </div>
        );
      }

      case "WebSearch": {
        const query = input.query as string | undefined;
        return query ? (
          <div className="mt-2 text-[11px] text-muted-foreground">
            &quot;{query}&quot;
          </div>
        ) : null;
      }

      case "Task": {
        const description = input.description as string | undefined;
        const prompt = input.prompt as string | undefined;
        return (
          <div className="mt-2 space-y-1">
            {description && (
              <div className="text-[11px] font-medium text-foreground">{description}</div>
            )}
            {prompt && expanded && (
              <div className="rounded bg-background/80 border border-border p-2 max-h-32 overflow-y-auto">
                <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
                  {prompt.length > 1000 ? prompt.slice(0, 1000) + "\n... (truncated)" : prompt}
                </pre>
              </div>
            )}
          </div>
        );
      }

      default: {
        if (Object.keys(input).length === 0) return null;
        return (
          <div className="mt-2 rounded bg-background/80 border border-border p-2 max-h-32 overflow-y-auto overflow-x-auto">
            <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
              {formatCode(input)}
            </pre>
          </div>
        );
      }
    }
  };

  // Summary line shown in the header
  const summaryText = (() => {
    if (toolName === "Edit" || toolName === "Write" || toolName === "Read") {
      return filePath ? shortenPath(filePath) : null;
    }
    if (toolName === "Bash") {
      const cmd = input.command as string | undefined;
      if (!cmd) return null;
      const short = cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
      return short;
    }
    if (toolName === "Grep") {
      return input.pattern as string | undefined;
    }
    if (toolName === "Glob") {
      return input.pattern as string | undefined;
    }
    if (toolName === "WebSearch") {
      return input.query as string | undefined;
    }
    if (toolName === "Task") {
      return input.description as string | undefined;
    }
    return null;
  })();

  return (
    <div className={`mt-2 rounded-md border p-2.5 transition-colors ${colorClass}`}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
          <span className="text-xs font-semibold text-foreground">{label}</span>
          {summaryText && !expanded && (
            <span className="text-[11px] font-mono text-muted-foreground truncate flex-1 min-w-0">
              {summaryText}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 ml-auto">
            {expanded ? "\u25B2" : "\u25BC"}
          </span>
        </button>
        {hasFile && (
          <button
            onClick={openInVSCode}
            className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-background/60 transition-colors"
            title={`Open ${filePath} in VS Code`}
          >
            VS
          </button>
        )}
      </div>
      {expanded && renderDetail()}
    </div>
  );
};
