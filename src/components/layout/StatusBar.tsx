import React, { useState, useEffect, useRef } from "react";
import { ipc } from "@/lib/ipc-client";
import type { StatusInfo } from "@/types/ipc";

interface StatusBarProps {
  onNotificationsClick?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({ onNotificationsClick }) => {
  const [status, setStatus] = useState<StatusInfo | null>(null);
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

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Listen for cost updates to refresh sooner
  useEffect(() => {
    const handler = () => {
      fetchStatus();
    };
    ipc.on("agent:cost", handler);
    ipc.on("agent:status", handler);
    return () => {
      ipc.off("agent:cost");
      ipc.off("agent:status");
    };
  }, []);

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

  return (
    <div className="flex items-center justify-between px-3 py-1 border-t border-border bg-card text-[11px] text-muted-foreground select-none">
      {/* Left section */}
      <div className="flex items-center gap-4">
        {/* Running agents */}
        <div className="flex items-center gap-1.5">
          {status.runningAgents > 0 ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
          ) : (
            <span className="inline-flex rounded-full h-2 w-2 bg-muted-foreground/30" />
          )}
          <span>
            {status.runningAgents} agent{status.runningAgents !== 1 ? "s" : ""} running
          </span>
          {status.queuedAgents > 0 && (
            <span className="text-yellow-500">
              ({status.queuedAgents} queued)
            </span>
          )}
        </div>

        {/* Automations */}
        {status.activeAutomations > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="font-mono">~</span>
            <span>
              {status.activeAutomations} automation{status.activeAutomations !== 1 ? "s" : ""}
            </span>
            {status.nextAutomationRun && (
              <span className="text-muted-foreground/60">
                [{status.nextAutomationRun}]
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-4">
        {/* Token usage */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono">^</span>
          <span>{formatTokens(status.totalTokensIn)} in</span>
          <span className="text-muted-foreground/40">/</span>
          <span>{formatTokens(status.totalTokensOut)} out</span>
        </div>

        {/* Session cost */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono">$</span>
          <span>{formatCost(status.totalCostUsd)}</span>
        </div>

        {/* API key status */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex rounded-full h-1.5 w-1.5 ${
              status.apiKeyValid ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span>
            {status.apiKeyValid ? status.apiKeyProvider : "No API key"}
          </span>
        </div>

        {/* Notifications */}
        {onNotificationsClick && (
          <button
            onClick={onNotificationsClick}
            className="hover:text-foreground transition-colors"
            title="Notifications"
          >
            bell
          </button>
        )}
      </div>
    </div>
  );
};
