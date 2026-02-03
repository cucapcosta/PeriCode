import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ipc } from "@/lib/ipc-client";
import { useProjectStore } from "@/stores/projectStore";
import { useAgentStore } from "@/stores/agentStore";
import type { Project, ThreadInfo, Skill, Automation } from "@/types/ipc";

interface CommandBarProps {
  open: boolean;
  onClose: () => void;
  onAction?: (action: CommandAction) => void;
}

export interface CommandAction {
  type: "navigate" | "launch_agent" | "open_project" | "run_skill" | "trigger_automation";
  payload?: Record<string, unknown>;
}

interface CommandItem {
  id: string;
  category: "action" | "project" | "thread" | "skill" | "automation";
  label: string;
  description?: string;
  action: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  open,
  onClose,
  onAction,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { setActiveProject, activeProjectId } = useProjectStore();
  const { setActiveThread } = useAgentStore();

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      loadData();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const loadData = async () => {
    try {
      const [projectList, skillList] = await Promise.all([
        ipc.invoke("project:list"),
        ipc.invoke("skill:list"),
      ]);
      setProjects(projectList);
      setSkills(skillList);

      if (activeProjectId) {
        const [threadList, automationList] = await Promise.all([
          ipc.invoke("thread:list", activeProjectId),
          ipc.invoke("automation:list", activeProjectId),
        ]);
        setThreads(threadList);
        setAutomations(automationList);
      }
    } catch (err) {
      console.error("Failed to load command bar data:", err);
    }
  };

  const allItems = useMemo((): CommandItem[] => {
    const items: CommandItem[] = [];

    // Quick actions
    items.push({
      id: "action:new-agent",
      category: "action",
      label: "New Agent",
      description: "Launch a new agent in the current project",
      action: () => {
        onAction?.({ type: "launch_agent" });
        onClose();
      },
    });
    items.push({
      id: "action:open-project",
      category: "action",
      label: "Open Project",
      description: "Open a project folder",
      action: () => {
        onAction?.({ type: "open_project" });
        onClose();
      },
    });

    // Projects
    for (const project of projects) {
      items.push({
        id: `project:${project.id}`,
        category: "project",
        label: project.name,
        description: project.path,
        action: () => {
          setActiveProject(project.id);
          onClose();
        },
      });
    }

    // Threads
    for (const thread of threads) {
      items.push({
        id: `thread:${thread.id}`,
        category: "thread",
        label: thread.title || "Untitled Thread",
        description: `${thread.status} - ${new Date(thread.createdAt).toLocaleDateString()}`,
        action: () => {
          setActiveThread(thread.id);
          onClose();
        },
      });
    }

    // Skills
    for (const skill of skills) {
      items.push({
        id: `skill:${skill.id}`,
        category: "skill",
        label: skill.name,
        description: skill.description,
        action: () => {
          onAction?.({
            type: "run_skill",
            payload: { skillId: skill.id },
          });
          onClose();
        },
      });
    }

    // Automations
    for (const auto of automations) {
      items.push({
        id: `automation:${auto.id}`,
        category: "automation",
        label: auto.name,
        description: auto.prompt.slice(0, 80),
        action: () => {
          onAction?.({
            type: "trigger_automation",
            payload: { automationId: auto.id },
          });
          onClose();
        },
      });
    }

    return items;
  }, [projects, threads, skills, automations, onAction, onClose, setActiveProject, setActiveThread]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;

    const q = query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false)
    );
  }, [allItems, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, filteredItems.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            filteredItems[selectedIndex].action();
          }
          break;
        case "Escape":
          onClose();
          break;
      }
    },
    [filteredItems, selectedIndex, onClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const categoryIcon = (category: CommandItem["category"]): string => {
    switch (category) {
      case "action":
        return ">";
      case "project":
        return "#";
      case "thread":
        return "@";
      case "skill":
        return "*";
      case "automation":
        return "~";
    }
  };

  const categoryColor = (category: CommandItem["category"]): string => {
    switch (category) {
      case "action":
        return "text-primary";
      case "project":
        return "text-blue-400";
      case "thread":
        return "text-green-400";
      case "skill":
        return "text-purple-400";
      case "automation":
        return "text-orange-400";
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center px-4 py-3 border-b border-border">
          <span className="text-muted-foreground mr-2">/</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or type a command..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono">
            esc
          </kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-80 overflow-auto py-1">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            filteredItems.map((item, i) => (
              <button
                key={item.id}
                onClick={item.action}
                className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                  i === selectedIndex
                    ? "bg-accent"
                    : "hover:bg-accent/50"
                }`}
              >
                <span
                  className={`w-5 text-center font-mono text-xs ${categoryColor(item.category)}`}
                >
                  {categoryIcon(item.category)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {item.label}
                  </p>
                  {item.description && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {item.description}
                    </p>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground capitalize shrink-0">
                  {item.category}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
          <span>
            <kbd className="px-1 py-0.5 rounded border border-border font-mono">
              up
            </kbd>{" "}
            <kbd className="px-1 py-0.5 rounded border border-border font-mono">
              down
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded border border-border font-mono">
              enter
            </kbd>{" "}
            select
          </span>
          <span>
            <kbd className="px-1 py-0.5 rounded border border-border font-mono">
              esc
            </kbd>{" "}
            close
          </span>
        </div>
      </div>
    </div>
  );
};
