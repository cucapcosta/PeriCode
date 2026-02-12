import React, { useEffect, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useAgentStore } from "@/stores/agentStore";

// Icons
const FolderIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const MessageIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const StopIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
  </svg>
);

const TrashIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

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
    <aside className="w-48 md:w-56 lg:w-64 border-r border-border bg-card/50 flex flex-col h-full flex-shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-border bg-card">
        <h1 className="text-lg font-bold text-foreground tracking-tight">PeriCode</h1>
        <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
          Uma ferramenta periquitante
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5 hidden sm:block">
          v0.6
        </p>
      </div>

      {/* Projects */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FolderIcon className="w-3.5 h-3.5" />
            Projects
          </h2>
          <button
            onClick={handleAddProject}
            disabled={addingProject}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Add project folder"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
        {projects.length === 0 ? (
          <div className="text-center py-6">
            <FolderIcon className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No projects yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click + to add a folder</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {projects.map((project) => {
              const runCount = getRunningCount(project.id);
              const isActive = activeProjectId === project.id;
              return (
                <li key={project.id}>
                  <button
                    onClick={() => setActiveProject(project.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                      isActive
                        ? "bg-primary/10 text-foreground border border-primary/20 shadow-sm"
                        : "text-foreground/80 hover:bg-accent hover:text-foreground border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FolderIcon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="truncate font-medium">{project.name}</span>
                      {runCount > 0 && (
                        <span className="flex-shrink-0 ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-green-500/20 text-green-400">
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
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <MessageIcon className="w-3.5 h-3.5" />
            Threads
          </h2>
          {threads.length === 0 ? (
            <div className="text-center py-6">
              <MessageIcon className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No threads yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Start a conversation</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {threads.map((thread) => {
                const isActive = activeThreadId === thread.id;
                return (
                  <li key={thread.id} className="group">
                    <button
                      onClick={() => setActiveThread(thread.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                        isActive
                          ? "bg-accent text-foreground shadow-sm"
                          : "text-foreground/80 hover:bg-accent/60 hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(thread.status)}`}
                        />
                        <span className="truncate flex-1 font-medium">
                          {thread.title || "Untitled"}
                        </span>
                        {/* Quick actions */}
                        {thread.status === "running" ? (
                          <button
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
                            className="hidden group-hover:flex p-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title="Cancel agent"
                          >
                            <StopIcon className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
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
                            className="hidden group-hover:flex p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title="Delete thread"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
};
