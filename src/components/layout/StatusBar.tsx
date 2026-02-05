import React, { useState, useEffect, useRef } from "react";
import { ipc } from "@/lib/ipc-client";
import type { StatusInfo, ThreadCostSummary } from "@/types/ipc";
import { estimateCost, getModelPricing } from "@/lib/model-pricing";

interface StatusBarProps {
  activeThreadId?: string | null;
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

export const StatusBar: React.FC<StatusBarProps> = ({ activeThreadId, onNotificationsClick }) => {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [threadCost, setThreadCost] = useState<ThreadCostSummary | null>(null);
  const [showModelDetail, setShowModelDetail] = useState(false);
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

  useEffect(() => {
    fetchStatus();
    fetchThreadCost();
    intervalRef.current = setInterval(() => {
      fetchStatus();
      fetchThreadCost();
    }, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeThreadId]);

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
    <div className="flex items-center px-3 py-1 border-t border-border bg-card text-[11px] text-muted-foreground select-none flex-shrink-0">
      {/* Left section */}
      <div className="flex items-center gap-1.5">
        {status.runningAgents > 0 ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        ) : (
          <span className="inline-flex rounded-full h-2 w-2 bg-muted-foreground/30" />
        )}
        <span>{status.runningAgents} running</span>
        {status.queuedAgents > 0 && (
          <span className="text-yellow-500">+{status.queuedAgents}q</span>
        )}
        {status.activeAutomations > 0 && (
          <>
            <span className="text-muted-foreground/30 mx-1">|</span>
            <span>{status.activeAutomations} auto</span>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section */}
      <div className="flex items-center gap-3 relative">
        {/* Scope label */}
        {isThreadScope && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
            thread
          </span>
        )}

        {/* Token usage - clickable for detail if model data exists */}
        <button
          onClick={() => hasModelData && setShowModelDetail((v) => !v)}
          className={`flex items-center gap-1.5 ${hasModelData ? "hover:text-foreground cursor-pointer" : "cursor-default"}`}
          title={hasModelData ? "Click for per-model breakdown" : "Token usage"}
        >
          <span>
            {formatTokens(displayTokensIn)}/{formatTokens(displayTokensOut)} tok
          </span>
          <span className="text-muted-foreground/30">|</span>
          <span className="font-mono">{formatCost(displayCost)}</span>
          {hasModelData && (
            <span className="text-[9px] opacity-60">{showModelDetail ? "\u25B2" : "\u25BC"}</span>
          )}
        </button>

        {/* Per-model detail popup */}
        {showModelDetail && hasModelData && (
          <div
            ref={detailRef}
            className="absolute bottom-full right-0 mb-2 w-80 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden"
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

        <span className="text-muted-foreground/30">|</span>
        <span className="flex items-center gap-1">
          <span
            className={`inline-flex rounded-full h-1.5 w-1.5 ${
              status.cliAvailable ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span>{status.cliAvailable ? "CLI" : "No CLI"}</span>
        </span>
        {onNotificationsClick && (
          <>
            <span className="text-muted-foreground/30">|</span>
            <button
              onClick={onNotificationsClick}
              className="hover:text-foreground transition-colors"
              title="Notifications"
            >
              bell
            </button>
          </>
        )}
      </div>
    </div>
  );
};
