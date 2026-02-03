import React, { useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { ThreadView } from "./components/agents/ThreadView";
import { NewAgentDialog } from "./components/agents/NewAgentDialog";
import { ProjectSettings } from "./components/settings/ProjectSettings";
import { useProjectStore } from "./stores/projectStore";

export const App: React.FC = () => {
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const { activeProjectId } = useProjectStore();

  return (
    <div className="flex h-full">
      <Sidebar />

      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        {activeProjectId && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <button
              onClick={() => setShowProjectSettings(true)}
              className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-accent"
            >
              Settings
            </button>
            <button
              onClick={() => setShowNewAgent(true)}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              + New Agent
            </button>
          </div>
        )}

        <ThreadView />
      </div>

      <NewAgentDialog
        open={showNewAgent}
        onClose={() => setShowNewAgent(false)}
      />

      {activeProjectId && (
        <ProjectSettings
          projectId={activeProjectId}
          open={showProjectSettings}
          onClose={() => setShowProjectSettings(false)}
        />
      )}
    </div>
  );
};
