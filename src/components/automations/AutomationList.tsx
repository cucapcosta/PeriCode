import React, { useEffect, useState } from "react";
import { ipc } from "@/lib/ipc-client";
import { useProjectStore } from "@/stores/projectStore";
import type { Automation } from "@/types/ipc";

interface AutomationListProps {
  onEdit?: (automation: Automation) => void;
  onNewAutomation?: () => void;
}

export const AutomationList: React.FC<AutomationListProps> = ({
  onEdit,
  onNewAutomation,
}) => {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const { activeProjectId } = useProjectStore();

  useEffect(() => {
    if (activeProjectId) {
      loadAutomations();
    }
  }, [activeProjectId]);

  const loadAutomations = async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const result = await ipc.invoke("automation:list", activeProjectId);
      setAutomations(result);
    } catch (err) {
      console.error("Failed to load automations:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnabled = async (id: string) => {
    try {
      await ipc.invoke("automation:toggleEnabled", id);
      setAutomations((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, enabled: !a.enabled } : a
        )
      );
    } catch (err) {
      console.error("Failed to toggle automation:", err);
    }
  };

  const handleTrigger = async (id: string) => {
    try {
      await ipc.invoke("automation:trigger", id);
    } catch (err) {
      console.error("Failed to trigger automation:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await ipc.invoke("automation:delete", id);
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to delete automation:", err);
    }
  };

  const triggerTypeLabel = (type: Automation["triggerType"]): string => {
    switch (type) {
      case "cron":
        return "Scheduled";
      case "file_change":
        return "File Watch";
      case "git_event":
        return "Git Event";
      case "manual":
        return "Manual";
    }
  };

  const triggerTypeColor = (type: Automation["triggerType"]): string => {
    switch (type) {
      case "cron":
        return "bg-blue-500/20 text-blue-400";
      case "file_change":
        return "bg-orange-500/20 text-orange-400";
      case "git_event":
        return "bg-purple-500/20 text-purple-400";
      case "manual":
        return "bg-gray-500/20 text-gray-400";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading automations...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          Automations
        </h2>
        {onNewAutomation && (
          <button
            onClick={onNewAutomation}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
          >
            + New Automation
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {automations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
            <p>No automations configured</p>
            {onNewAutomation && (
              <button
                onClick={onNewAutomation}
                className="text-primary text-xs hover:underline"
              >
                Create your first automation
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {automations.map((auto) => (
              <div
                key={auto.id}
                className="px-4 py-3 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Enable/disable toggle */}
                    <button
                      onClick={() => handleToggleEnabled(auto.id)}
                      className={`w-8 h-4 rounded-full relative transition-colors ${
                        auto.enabled ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          auto.enabled ? "left-4" : "left-0.5"
                        }`}
                      />
                    </button>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-foreground truncate">
                          {auto.name}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${triggerTypeColor(auto.triggerType)}`}
                        >
                          {triggerTypeLabel(auto.triggerType)}
                        </span>
                        {auto.schedule && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {auto.schedule}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {auto.prompt.slice(0, 80)}
                        {auto.prompt.length > 80 ? "..." : ""}
                      </p>
                      {auto.lastRunAt && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Last run: {new Date(auto.lastRunAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <button
                      onClick={() => handleTrigger(auto.id)}
                      disabled={!auto.enabled}
                      className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80 disabled:opacity-50"
                    >
                      Run Now
                    </button>
                    {onEdit && (
                      <button
                        onClick={() => onEdit(auto)}
                        className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(auto.id)}
                      className="px-2 py-1 rounded text-[10px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
