import React, { useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { ThreadView } from "./components/agents/ThreadView";
import { NewAgentDialog } from "./components/agents/NewAgentDialog";
import { ProjectSettings } from "./components/settings/ProjectSettings";
import { AllAgentsDashboard } from "./components/agents/AllAgentsDashboard";
import { SkillBrowser } from "./components/skills/SkillBrowser";
import { SkillEditor } from "./components/skills/SkillEditor";
import { SkillInstaller } from "./components/skills/SkillInstaller";
import { AutomationInbox } from "./components/automations/AutomationInbox";
import { useProjectStore } from "./stores/projectStore";
import { useAgentStore } from "./stores/agentStore";
import type { Skill } from "./types/ipc";

type MainView = "thread" | "dashboard" | "split" | "skills" | "inbox";

export const App: React.FC = () => {
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [showSkillInstaller, setShowSkillInstaller] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [mainView, setMainView] = useState<MainView>("thread");
  const { activeProjectId } = useProjectStore();
  const { activeThreadId } = useAgentStore();

  return (
    <div className="flex h-full">
      <Sidebar />

      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        {activeProjectId && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowProjectSettings(true)}
                className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-accent"
              >
                Settings
              </button>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  onClick={() => setMainView("thread")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    mainView === "thread"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  Thread
                </button>
                <button
                  onClick={() => setMainView("dashboard")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                    mainView === "dashboard"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  All Agents
                </button>
                <button
                  onClick={() => setMainView("split")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                    mainView === "split"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  Split
                </button>
                <button
                  onClick={() => setMainView("skills")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                    mainView === "skills"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  Skills
                </button>
                <button
                  onClick={() => setMainView("inbox")}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                    mainView === "inbox"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  Inbox
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mainView === "skills" && (
                <>
                  <button
                    onClick={() => setShowSkillInstaller(true)}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm text-foreground hover:bg-accent"
                  >
                    Import
                  </button>
                  <button
                    onClick={() => {
                      setEditingSkill(null);
                      setShowSkillEditor(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                  >
                    + New Skill
                  </button>
                </>
              )}
              {mainView !== "skills" && mainView !== "inbox" && (
                <button
                  onClick={() => setShowNewAgent(true)}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                >
                  + New Agent
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main content area */}
        {mainView === "thread" && <ThreadView />}
        {mainView === "dashboard" && <AllAgentsDashboard />}
        {mainView === "inbox" && <AutomationInbox />}
        {mainView === "skills" && (
          <SkillBrowser
            onEdit={(skill) => {
              setEditingSkill(skill);
              setShowSkillEditor(true);
            }}
          />
        )}
        {mainView === "split" && (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 border-r border-border overflow-hidden">
              <ThreadView />
            </div>
            <div className="flex-1 overflow-hidden">
              {activeThreadId ? (
                <AllAgentsDashboard />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a thread to view
                </div>
              )}
            </div>
          </div>
        )}
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

      <SkillEditor
        open={showSkillEditor}
        onClose={() => {
          setShowSkillEditor(false);
          setEditingSkill(null);
        }}
        editingSkill={editingSkill}
      />

      <SkillInstaller
        open={showSkillInstaller}
        onClose={() => setShowSkillInstaller(false)}
      />
    </div>
  );
};
