import React, { useEffect, useState, useMemo } from "react";
import { ipc } from "@/lib/ipc-client";
import type { AutomationRun, Automation } from "@/types/ipc";
import { useProjectStore } from "@/stores/projectStore";

type StatusFilter = "all" | "completed" | "failed" | "running" | "archived";

export const AutomationInbox: React.FC = () => {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { activeProjectId } = useProjectStore();

  useEffect(() => {
    if (activeProjectId) {
      loadData();
    }
  }, [activeProjectId]);

  const loadData = async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const [automationList, inboxRuns] = await Promise.all([
        ipc.invoke("automation:list", activeProjectId),
        ipc.invoke("automation:getInbox", {
          projectId: activeProjectId,
          unreadOnly,
        }),
      ]);
      setAutomations(automationList);
      setRuns(inboxRuns);
    } catch (err) {
      console.error("Failed to load inbox:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredRuns = useMemo(() => {
    if (statusFilter === "all") return runs;
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);

  const unreadCount = useMemo(
    () => runs.filter((r) => !r.read).length,
    [runs]
  );

  const getAutomationName = (automationId: string): string => {
    const automation = automations.find((a) => a.id === automationId);
    return automation?.name ?? "Unknown Automation";
  };

  const handleMarkRead = async (runId: string) => {
    try {
      await ipc.invoke("automation:markRead", runId);
      setRuns((prev) =>
        prev.map((r) => (r.id === runId ? { ...r, read: true } : r))
      );
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  const handleArchive = async (runId: string) => {
    try {
      await ipc.invoke("automation:archiveRun", runId);
      setRuns((prev) =>
        prev.map((r) =>
          r.id === runId ? { ...r, status: "archived" as const } : r
        )
      );
    } catch (err) {
      console.error("Failed to archive:", err);
    }
  };

  const handleMarkAllRead = async () => {
    const unreadRuns = runs.filter((r) => !r.read);
    for (const run of unreadRuns) {
      await ipc.invoke("automation:markRead", run.id);
    }
    setRuns((prev) => prev.map((r) => ({ ...r, read: true })));
  };

  const handleArchiveAll = async () => {
    const completedRuns = runs.filter(
      (r) => r.status === "completed" || r.status === "failed"
    );
    for (const run of completedRuns) {
      await ipc.invoke("automation:archiveRun", run.id);
    }
    setRuns((prev) =>
      prev.map((r) =>
        r.status === "completed" || r.status === "failed"
          ? { ...r, status: "archived" as const }
          : r
      )
    );
  };

  const statusColor = (status: AutomationRun["status"]) => {
    switch (status) {
      case "running":
        return "bg-yellow-500/20 text-yellow-400";
      case "completed":
        return "bg-green-500/20 text-green-400";
      case "failed":
        return "bg-red-500/20 text-red-400";
      case "archived":
        return "bg-gray-500/20 text-gray-400";
    }
  };

  const getRunSummary = (run: AutomationRun): string => {
    if (!run.result) return "No results available";
    const result = run.result as Record<string, unknown>;
    const conversation = result.conversation as
      | Array<{ role: string; content: string }>
      | undefined;
    if (conversation && conversation.length > 0) {
      const lastAssistant = conversation
        .filter((c) => c.role === "assistant")
        .pop();
      if (lastAssistant) {
        return lastAssistant.content.slice(0, 200) +
          (lastAssistant.content.length > 200 ? "..." : "");
      }
    }
    if (result.error) {
      return `Error: ${result.error}`;
    }
    return "No output";
  };

  const getConversation = (
    run: AutomationRun
  ): Array<{ role: string; content: string }> => {
    if (!run.result) return [];
    const result = run.result as Record<string, unknown>;
    return (result.conversation as Array<{ role: string; content: string }>) ?? [];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading inbox...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            Automation Inbox
          </h2>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
              {unreadCount} unread
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Status filter */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["all", "completed", "failed", "running", "archived"] as StatusFilter[]).map(
              (filter) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    statusFilter === filter
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  } ${filter !== "all" ? "border-l border-border" : ""}`}
                >
                  {filter}
                </button>
              )
            )}
          </div>

          {/* Bulk actions */}
          <button
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className="px-2.5 py-1 rounded text-xs text-foreground bg-accent hover:bg-accent/80 disabled:opacity-50"
          >
            Mark All Read
          </button>
          <button
            onClick={handleArchiveAll}
            className="px-2.5 py-1 rounded text-xs text-foreground bg-accent hover:bg-accent/80"
          >
            Archive All
          </button>
        </div>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-auto">
        {filteredRuns.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {runs.length === 0
              ? "No automation runs yet"
              : "No runs match the current filter"}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredRuns.map((run) => (
              <div
                key={run.id}
                className={`px-4 py-3 hover:bg-accent/30 transition-colors ${
                  !run.read ? "bg-primary/5" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {!run.read && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                      <span className="text-sm font-medium text-foreground truncate">
                        {getAutomationName(run.automationId)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor(run.status)}`}
                      >
                        {run.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {new Date(run.startedAt).toLocaleString()}
                      {run.finishedAt &&
                        ` - ${new Date(run.finishedAt).toLocaleString()}`}
                    </p>
                    <p className="text-xs text-foreground/80 line-clamp-2">
                      {getRunSummary(run)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!run.read && (
                      <button
                        onClick={() => handleMarkRead(run.id)}
                        className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80"
                      >
                        Mark Read
                      </button>
                    )}
                    <button
                      onClick={() =>
                        setExpandedRun(
                          expandedRun === run.id ? null : run.id
                        )
                      }
                      className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80"
                    >
                      {expandedRun === run.id ? "Collapse" : "Expand"}
                    </button>
                    {run.status !== "archived" && (
                      <button
                        onClick={() => handleArchive(run.id)}
                        className="px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded conversation log */}
                {expandedRun === run.id && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <h4 className="text-xs font-semibold text-foreground mb-2">
                      Conversation Log
                    </h4>
                    <div className="space-y-2 max-h-64 overflow-auto">
                      {getConversation(run).length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No conversation data available
                        </p>
                      ) : (
                        getConversation(run).map((entry, i) => (
                          <div
                            key={i}
                            className={`text-xs rounded-lg px-3 py-2 ${
                              entry.role === "assistant"
                                ? "bg-muted text-foreground"
                                : "bg-primary/10 text-foreground"
                            }`}
                          >
                            <span className="font-semibold capitalize">
                              {entry.role}:
                            </span>{" "}
                            <span className="whitespace-pre-wrap">
                              {entry.content}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Cost info */}
                    {run.result &&
                      typeof (run.result as Record<string, unknown>).totalCostUsd === "number" && (
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Cost: $
                        {(
                          (run.result as Record<string, unknown>)
                            .totalCostUsd as number
                        ).toFixed(4)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
