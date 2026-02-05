import React, { useEffect, useState } from "react";
import { ipc } from "@/lib/ipc-client";
import { useAgentStore } from "@/stores/agentStore";
import { useProjectStore } from "@/stores/projectStore";
import { AgentCard } from "./AgentCard";
import type { ThreadInfo } from "@/types/ipc";

export const AllAgentsDashboard: React.FC = () => {
  const { setActiveThread, cancelAgent } = useAgentStore();
  const { projects } = useProjectStore();
  const [allThreads, setAllThreads] = useState<ThreadInfo[]>([]);
  const [filter, setFilter] = useState<"all" | "running" | "completed" | "failed">("all");

  useEffect(() => {
    const loadAll = async () => {
      const threads: ThreadInfo[] = [];
      for (const project of projects) {
        try {
          const projectThreads = await ipc.invoke("thread:list", project.id);
          threads.push(...projectThreads);
        } catch {
          // Skip projects that fail to load
        }
      }
      // Sort by most recent first
      threads.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      setAllThreads(threads);
    };

    loadAll();

    // Set up event listeners for status changes
    const handleStatus = () => {
      loadAll();
    };
    ipc.on("agent:status", handleStatus);

    return () => {
      ipc.off("agent:status", handleStatus);
    };
  }, [projects]);

  const getProjectName = (projectId: string): string => {
    return projects.find((p) => p.id === projectId)?.name ?? "Unknown";
  };

  const filteredThreads =
    filter === "all"
      ? allThreads
      : allThreads.filter((t) => t.status === filter);

  const runningCount = allThreads.filter((t) => t.status === "running").length;
  const completedCount = allThreads.filter(
    (t) => t.status === "completed"
  ).length;
  const failedCount = allThreads.filter((t) => t.status === "failed").length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">All Agents</h2>
        <div className="flex gap-4 mt-2 text-sm">
          <span className="text-green-400">{runningCount} running</span>
          <span className="text-blue-400">{completedCount} completed</span>
          <span className="text-red-400">{failedCount} failed</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 p-4 pb-0">
        {(["all", "running", "completed", "failed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Agent cards */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredThreads.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm mt-8">
            No agents {filter === "all" ? "yet" : `with status "${filter}"`}
          </p>
        ) : (
          <div className="grid gap-3">
            {filteredThreads.map((thread) => (
              <AgentCard
                key={thread.id}
                thread={thread}
                projectName={getProjectName(thread.projectId)}
                onSelect={setActiveThread}
                onCancel={cancelAgent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
