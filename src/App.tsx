import React, { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { ThreadView } from "./components/agents/ThreadView";
import { NewAgentDialog } from "./components/agents/NewAgentDialog";
import { ProjectSettings } from "./components/settings/ProjectSettings";
import { AllAgentsDashboard } from "./components/agents/AllAgentsDashboard";
import { SkillBrowser } from "./components/skills/SkillBrowser";
import { SkillEditor } from "./components/skills/SkillEditor";
import { SkillInstaller } from "./components/skills/SkillInstaller";
import { AutomationInbox } from "./components/automations/AutomationInbox";
import { AutomationList } from "./components/automations/AutomationList";
import { AutomationEditor } from "./components/automations/AutomationEditor";
import { CommandBar, type CommandAction } from "./components/common/CommandBar";
import { useProjectStore } from "./stores/projectStore";
import { useAgentStore } from "./stores/agentStore";
import type { Skill, Automation } from "./types/ipc";

type MainView = "thread" | "dashboard" | "split" | "skills" | "inbox" | "automations";

export const App: React.FC = () => {
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [showSkillInstaller, setShowSkillInstaller] = useState(false);
  const [showAutomationEditor, setShowAutomationEditor] = useState(false);
  const [showCommandBar, setShowCommandBar] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [mainView, setMainView] = useState<MainView>("thread");
  const { activeProjectId } = useProjectStore();
  const { activeThreadId } = useAgentStore();

  // Global keyboard shortcut: Ctrl+K / Cmd+K for command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandBar((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleCommandAction = useCallback((action: CommandAction) => {
    switch (action.type) {
      case "launch_agent":
        setShowNewAgent(true);
        break;
      case "open_project":
        // Handled by project store
        break;
    }
  }, []);

  const viewButtons: Array<{ key: MainView; label: string }> = [
    { key: "thread", label: "Thread" },
    { key: "dashboard", label: "Agents" },
    { key: "split", label: "Split" },
    { key: "skills", label: "Skills" },
    { key: "automations", label: "Auto" },
    { key: "inbox", label: "Inbox" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
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
                {viewButtons.map((btn, i) => (
                  <button
                    key={btn.key}
                    onClick={() => setMainView(btn.key)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      mainView === btn.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    } ${i > 0 ? "border-l border-border" : ""}`}
                  >
                    {btn.label}
                  </button>
                ))}
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
              {mainView === "automations" && (
                <button
                  onClick={() => {
                    setEditingAutomation(null);
                    setShowAutomationEditor(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                >
                  + New Automation
                </button>
              )}
              {mainView !== "skills" && mainView !== "inbox" && mainView !== "automations" && (
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
        {mainView === "automations" && (
          <AutomationList
            onEdit={(auto) => {
              setEditingAutomation(auto);
              setShowAutomationEditor(true);
            }}
            onNewAutomation={() => {
              setEditingAutomation(null);
              setShowAutomationEditor(true);
            }}
          />
        )}
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
      </div>

      <StatusBar />

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

      <AutomationEditor
        open={showAutomationEditor}
        onClose={() => {
          setShowAutomationEditor(false);
          setEditingAutomation(null);
        }}
        editingAutomation={editingAutomation}
      />

      <CommandBar
        open={showCommandBar}
        onClose={() => setShowCommandBar(false)}
        onAction={handleCommandAction}
      />
    </div>
  );
};
