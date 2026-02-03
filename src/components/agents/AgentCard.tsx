import React from "react";
import type { ThreadInfo } from "@/types/ipc";

interface AgentCardProps {
  thread: ThreadInfo;
  projectName?: string;
  onSelect: (threadId: string) => void;
  onCancel: (threadId: string) => void;
}

const statusConfig: Record<
  string,
  { label: string; dotClass: string; bgClass: string }
> = {
  running: {
    label: "Running",
    dotClass: "bg-green-500 animate-pulse",
    bgClass: "border-green-500/30",
  },
  completed: {
    label: "Completed",
    dotClass: "bg-blue-500",
    bgClass: "border-blue-500/30",
  },
  failed: {
    label: "Failed",
    dotClass: "bg-red-500",
    bgClass: "border-red-500/30",
  },
  paused: {
    label: "Paused",
    dotClass: "bg-yellow-500",
    bgClass: "border-yellow-500/30",
  },
};

export const AgentCard: React.FC<AgentCardProps> = ({
  thread,
  projectName,
  onSelect,
  onCancel,
}) => {
  const config = statusConfig[thread.status] ?? statusConfig.paused;

  return (
    <div
      className={`rounded-lg border ${config.bgClass} bg-card p-4 cursor-pointer hover:bg-accent/30 transition-colors`}
      onClick={() => onSelect(thread.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect(thread.id);
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${config.dotClass}`} />
          <span className="text-sm font-medium text-foreground truncate">
            {thread.title || "Untitled"}
          </span>
        </div>
        {thread.status === "running" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel(thread.id);
            }}
            className="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 flex-shrink-0"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{config.label}</span>
        {projectName && (
          <>
            <span className="text-border">|</span>
            <span className="truncate">{projectName}</span>
          </>
        )}
        {thread.worktreeBranch && (
          <>
            <span className="text-border">|</span>
            <span className="truncate font-mono">{thread.worktreeBranch}</span>
          </>
        )}
      </div>

      <div className="text-xs text-muted-foreground mt-2">
        {new Date(thread.createdAt).toLocaleString()}
      </div>
    </div>
  );
};
