import React, { useEffect, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useAgentStore } from "@/stores/agentStore";

export const Sidebar: React.FC = () => {
  const {
    projects,
    activeProjectId,
    loadProjects,
    setActiveProject,
    openFolder,
  } = useProjectStore();
  const {
    threads,
    loadThreads,
    setActiveThread,
    activeThreadId,
    cancelAgent,
    deleteThread,
  } = useAgentStore();
  const [addingProject, setAddingProject] = useState(false);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (activeProjectId) {
      loadThreads(activeProjectId);
    }
  }, [activeProjectId, loadThreads]);

  const handleAddProject = async () => {
    setAddingProject(true);
    try {
      await openFolder();
    } catch (err) {
      console.error("Failed to add project:", err);
    } finally {
      setAddingProject(false);
    }
  };

  // Count running agents per project
  const getRunningCount = (projectId: string): number => {
    if (projectId !== activeProjectId) return 0;
    return threads.filter((t) => t.status === "running").length;
  };

  const statusDotClass = (status: string): string => {
    switch (status) {
      case "running":
        return "bg-green-500 animate-pulse";
      case "completed":
        return "bg-blue-500";
      case "failed":
        return "bg-red-500";
      case "paused":
        return "bg-yellow-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h1 className="text-lg font-bold text-foreground">PeriCode</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Multi-agent command center
        </p>
      </div>

      {/* Projects */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Projects
          </h2>
          <button
            onClick={handleAddProject}
            disabled={addingProject}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Add project folder"
          >
            + Add
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet</p>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => {
              const runCount = getRunningCount(project.id);
              return (
                <li key={project.id}>
                  <button
                    onClick={() => setActiveProject(project.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activeProjectId === project.id
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{project.name}</span>
                      {runCount > 0 && (
                        <span className="flex-shrink-0 ml-2 px-1.5 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">
                          {runCount}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Threads for active project */}
      {activeProjectId && (
        <div className="flex-1 overflow-y-auto p-3 border-t border-border">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Threads
          </h2>
          {threads.length === 0 ? (
            <p className="text-sm text-muted-foreground">No threads yet</p>
          ) : (
            <ul className="space-y-1">
              {threads.map((thread) => (
                <li key={thread.id} className="group">
                  <button
                    onClick={() => setActiveThread(thread.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activeThreadId === thread.id
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(thread.status)}`}
                      />
                      <span className="truncate flex-1">
                        {thread.title || "Untitled"}
                      </span>
                      {/* Quick actions */}
                      {thread.status === "running" ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelAgent(thread.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              cancelAgent(thread.id);
                            }
                          }}
                          className="hidden group-hover:inline-flex text-xs text-red-400 hover:text-red-300 flex-shrink-0"
                          title="Cancel agent"
                        >
                          Stop
                        </span>
                      ) : (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteThread(thread.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              deleteThread(thread.id);
                            }
                          }}
                          className="hidden group-hover:inline-flex text-xs text-muted-foreground hover:text-red-400 flex-shrink-0"
                          title="Delete thread"
                        >
                          Del
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
};
