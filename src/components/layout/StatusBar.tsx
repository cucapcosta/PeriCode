import React, { useState, useEffect, useRef } from "react";
import { ipc } from "@/lib/ipc-client";
import type { StatusInfo, ThreadCostSummary } from "@/types/ipc";
import { estimateCost, getModelPricing } from "@/lib/model-pricing";

// Icons as inline SVG components for better visual hierarchy
const ActivityIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
  </svg>
);

const TokenIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v12M6 12h12" />
  </svg>
);

const DollarIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const TerminalIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4,17 10,11 4,5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const BellIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const GitBranchIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const GitDiffIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 3v18M3 12h18" />
  </svg>
);

interface GitDiffStats {
  additions: number;
  deletions: number;
  files: number;
}

interface StatusBarProps {
  activeThreadId?: string | null;
  activeProjectId?: string | null;
  onNotificationsClick?: () => void;
}

/** Shorten a model ID for display: "claude-opus-4-5-20251101" -> "opus-4.5" */
function shortModelName(modelId: string): string {
  // Match patterns like claude-sonnet-4-20250514 or claude-opus-4-5-20251101
  const m = modelId.match(/claude-(\w+)-([\d]+(?:-[\d]+)?)-\d{8}/);
  if (m) {
    const family = m[1]; // e.g. "opus", "sonnet", "haiku"
    const version = m[2].replace("-", "."); // "4-5" -> "4.5", "4" -> "4"
    return `${family}-${version}`;
  }
  // Fallback: just trim "claude-" prefix if present
  return modelId.replace(/^claude-/, "");
}

export const StatusBar: React.FC<StatusBarProps> = ({ activeThreadId, activeProjectId, onNotificationsClick }) => {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [threadCost, setThreadCost] = useState<ThreadCostSummary | null>(null);
  const [showModelDetail, setShowModelDetail] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [diffStats, setDiffStats] = useState<GitDiffStats | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const info = await ipc.invoke("status:getInfo");
      // Validate shape - IPC mocks may return unexpected types
      if (info && typeof info === "object" && "runningAgents" in info) {
        setStatus(info);
      }
    } catch {
      // Silently fail - status bar is non-critical
    }
  };

  const fetchThreadCost = async () => {
    if (!activeThreadId) {
      setThreadCost(null);
      return;
    }
    try {
      const summary = await ipc.invoke("thread:getCostSummary", activeThreadId);
      if (summary && typeof summary === "object" && "threadId" in summary) {
        setThreadCost(summary as ThreadCostSummary);
      }
    } catch {
      setThreadCost(null);
    }
  };

  const fetchBranch = async () => {
    if (!activeProjectId) {
      setCurrentBranch(null);
      return;
    }
    try {
      const branch = await ipc.invoke("git:getCurrentBranch", activeProjectId);
      setCurrentBranch(branch as string | null);
    } catch {
      setCurrentBranch(null);
    }
  };

  const fetchDiffStats = async () => {
    if (!activeProjectId) {
      setDiffStats(null);
      return;
    }
    try {
      const stats = await ipc.invoke("git:getDiffStats", activeProjectId);
      setDiffStats(stats as GitDiffStats | null);
    } catch {
      setDiffStats(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchThreadCost();
    fetchBranch();
    fetchDiffStats();
    intervalRef.current = setInterval(() => {
      fetchStatus();
      fetchThreadCost();
      fetchBranch();
      fetchDiffStats();
    }, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeThreadId, activeProjectId]);

  // Listen for cost updates to refresh sooner
  useEffect(() => {
    const costHandler = () => {
      fetchStatus();
      fetchThreadCost();
    };
    const statusHandler = () => {
      fetchStatus();
      fetchThreadCost();
    };
    ipc.on("agent:cost", costHandler);
    ipc.on("agent:status", statusHandler);
    return () => {
      ipc.off("agent:cost", costHandler);
      ipc.off("agent:status", statusHandler);
    };
  }, [activeThreadId]);

  // Close detail popup on outside click
  useEffect(() => {
    if (!showModelDetail) return;
    const handleClick = (e: MouseEvent) => {
      if (detailRef.current && !detailRef.current.contains(e.target as Node)) {
        setShowModelDetail(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showModelDetail]);

  // Close popup when thread changes
  useEffect(() => {
    setShowModelDetail(false);
  }, [activeThreadId]);

  const formatCost = (usd: number): string => {
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  };

  const formatTokens = (count: number): string => {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
  };

  if (!status) return null;

  // Use thread data if a thread is selected, otherwise fall back to global
  const displayCost = threadCost ? threadCost.totalCostUsd : status.totalCostUsd;
  const displayTokensIn = threadCost ? threadCost.totalTokensIn : status.totalTokensIn;
  const displayTokensOut = threadCost ? threadCost.totalTokensOut : status.totalTokensOut;
  const displayModelUsage = threadCost && Object.keys(threadCost.modelUsage).length > 0
    ? threadCost.modelUsage
    : status.modelUsage;

  const modelEntries = Object.entries(displayModelUsage ?? {});
  const hasModelData = modelEntries.length > 0;
  const isThreadScope = !!threadCost;

  return (
    <div className="flex items-center px-3 sm:px-4 py-1.5 border-t border-border bg-card/80 backdrop-blur-sm text-xs text-muted-foreground select-none flex-shrink-0">
      {/* Left section - Agent status */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-1.5">
          {status.runningAgents > 0 ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
          ) : (
            <span className="inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/40" />
          )}
          <span className={status.runningAgents > 0 ? "text-foreground font-medium" : ""}>
            {status.runningAgents} running
          </span>
        </div>
        {status.queuedAgents > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 text-[11px] font-medium">
            +{status.queuedAgents} queued
          </span>
        )}
        {status.activeAutomations > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[11px] font-medium">
            {status.activeAutomations} auto
          </span>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section */}
      <div className="flex items-center gap-2 sm:gap-3 relative">
        {/* Git branch indicator */}
        {currentBranch && (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <GitBranchIcon />
              <span className="font-mono text-[11px] max-w-[120px] truncate" title={currentBranch}>
                {currentBranch}
              </span>
            </span>
            {/* Git diff stats */}
            {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
              <span
                className="flex items-center gap-1 text-[11px] font-mono"
                title={`${diffStats.files} file${diffStats.files !== 1 ? "s" : ""} changed`}
              >
                {diffStats.additions > 0 && (
                  <span className="text-green-400">+{diffStats.additions}</span>
                )}
                {diffStats.deletions > 0 && (
                  <span className="text-red-400">-{diffStats.deletions}</span>
                )}
              </span>
            )}
            <span className="w-px h-3 bg-border" />
          </>
        )}
        {/* Scope label */}
        {isThreadScope && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
            Thread
          </span>
        )}

        {/* Token usage - clickable for detail if model data exists */}
        <button
          onClick={() => hasModelData && setShowModelDetail((v) => !v)}
          className={`flex items-center gap-2 px-2 py-1 rounded-md transition-colors ${
            hasModelData
              ? "hover:bg-accent hover:text-foreground cursor-pointer"
              : "cursor-default"
          }`}
          title={hasModelData ? "Click for per-model breakdown" : "Token usage"}
        >
          <span className="flex items-center gap-1 text-muted-foreground">
            <TokenIcon />
            <span className="font-mono text-foreground/80">
              {formatTokens(displayTokensIn)}<span className="text-muted-foreground/60">/</span>{formatTokens(displayTokensOut)}
            </span>
          </span>
          <span className="w-px h-3 bg-border" />
          <span className="flex items-center gap-1">
            <DollarIcon />
            <span className="font-mono font-medium text-foreground">{formatCost(displayCost)}</span>
          </span>
          {hasModelData && (
            <svg
              className={`w-3 h-3 text-muted-foreground/60 transition-transform ${showModelDetail ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6,9 12,15 18,9" />
            </svg>
          )}
        </button>

        {/* Per-model detail popup */}
        {showModelDetail && hasModelData && (
          <div
            ref={detailRef}
            className="absolute bottom-full right-0 mb-2 w-[calc(100vw-1rem)] sm:w-80 max-w-80 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold text-foreground">
                Token Usage by Model
                {isThreadScope && (
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(thread)</span>
                )}
              </span>
            </div>
            <div className="divide-y divide-border">
              {modelEntries
                .sort(([, a], [, b]) => b.costUsd - a.costUsd)
                .map(([model, usage]) => {
                  const totalIn = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
                  const totalOut = usage.outputTokens;
                  const pricing = getModelPricing(model);
                  const calcCost = estimateCost(
                    model,
                    usage.inputTokens,
                    usage.outputTokens,
                    usage.cacheCreationInputTokens,
                    usage.cacheReadInputTokens
                  );
                  return (
                    <div key={model} className="px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-foreground">
                          {shortModelName(model)}
                        </span>
                        <div className="flex items-center gap-2 text-xs font-mono">
                          <span className="text-foreground" title="CLI reported cost">
                            {formatCost(usage.costUsd)}
                          </span>
                          <span className="text-muted-foreground/50">|</span>
                          <span className="text-blue-400" title="Calculated from token pricing">
                            {formatCost(calcCost)}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px]">
                        <span className="text-muted-foreground">Input</span>
                        <span className="text-right font-mono">{formatTokens(usage.inputTokens)}</span>
                        <span className="text-right font-mono text-muted-foreground/60">${pricing.inputPerMTok}/M</span>
                        <span className="text-muted-foreground">Output</span>
                        <span className="text-right font-mono">{formatTokens(usage.outputTokens)}</span>
                        <span className="text-right font-mono text-muted-foreground/60">${pricing.outputPerMTok}/M</span>
                        {usage.cacheReadInputTokens > 0 && (
                          <>
                            <span className="text-muted-foreground">Cache read</span>
                            <span className="text-right font-mono">{formatTokens(usage.cacheReadInputTokens)}</span>
                            <span className="text-right font-mono text-muted-foreground/60">${pricing.cacheReadPerMTok}/M</span>
                          </>
                        )}
                        {usage.cacheCreationInputTokens > 0 && (
                          <>
                            <span className="text-muted-foreground">Cache write</span>
                            <span className="text-right font-mono">{formatTokens(usage.cacheCreationInputTokens)}</span>
                            <span className="text-right font-mono text-muted-foreground/60">${pricing.cacheWritePerMTok}/M</span>
                          </>
                        )}
                        <span className="text-muted-foreground font-medium">Total</span>
                        <span className="text-right font-mono font-medium">
                          {formatTokens(totalIn + totalOut)}
                        </span>
                        <span />
                      </div>
                    </div>
                  );
                })}
            </div>
            {/* Summary footer */}
            <div className="px-3 py-2 border-t border-border bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  {modelEntries.length} model{modelEntries.length !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-2 text-xs font-mono font-semibold">
                  <span className="text-foreground" title="CLI reported">
                    {formatCost(displayCost)}
                  </span>
                  <span className="text-muted-foreground/50">|</span>
                  <span className="text-blue-400" title="Calculated">
                    {formatCost(
                      modelEntries.reduce(
                        (sum, [model, usage]) =>
                          sum +
                          estimateCost(
                            model,
                            usage.inputTokens,
                            usage.outputTokens,
                            usage.cacheCreationInputTokens,
                            usage.cacheReadInputTokens
                          ),
                        0
                      )
                    )}
                  </span>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-0.5 text-[9px] text-muted-foreground/60">
                <span>CLI</span>
                <span className="text-blue-400/60">Calc</span>
              </div>
            </div>
          </div>
        )}

        <span className="w-px h-3 bg-border" />
        <span
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${
            status.cliAvailable
              ? "text-green-400"
              : "text-red-400 bg-red-500/10"
          }`}
          title={status.cliAvailable ? "Claude CLI available" : "Claude CLI not found"}
        >
          <TerminalIcon />
          <span className="text-[11px] font-medium">
            {status.cliAvailable ? "CLI" : "No CLI"}
          </span>
        </span>
        {onNotificationsClick && (
          <button
            onClick={onNotificationsClick}
            className="p-1.5 rounded-md hover:bg-accent hover:text-foreground transition-colors"
            title="Notifications"
          >
            <BellIcon />
          </button>
        )}
      </div>
    </div>
  );
};
