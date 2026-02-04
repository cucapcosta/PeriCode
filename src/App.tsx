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
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { ToastContainer } from "./components/common/Toast";
import { NotificationCenter } from "./components/common/NotificationCenter";
const EmbeddedTerminal = React.lazy(() =>
  import("./components/terminal/EmbeddedTerminal").then((m) => ({ default: m.EmbeddedTerminal }))
);
import { useProjectStore } from "./stores/projectStore";
import { useAgentStore } from "./stores/agentStore";
import { ipc } from "./lib/ipc-client";
import type { Skill, Automation } from "./types/ipc";

type MainView = "thread" | "dashboard" | "split" | "skills" | "inbox" | "automations" | "terminal";

export const App: React.FC = () => {
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [showSkillInstaller, setShowSkillInstaller] = useState(false);
  const [showAutomationEditor, setShowAutomationEditor] = useState(false);
  const [showCommandBar, setShowCommandBar] = useState(false);
  const [showAppSettings, setShowAppSettings] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [mainView, setMainView] = useState<MainView>("thread");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { activeProjectId, projects } = useProjectStore();
  const { threads, activeThreadId, setActiveThread, cancelAgent } = useAgentStore();

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Cmd+K: Command palette
      if (mod && e.key === "k") {
        e.preventDefault();
        setShowCommandBar((prev) => !prev);
        return;
      }
      // Cmd+,: App settings
      if (mod && e.key === ",") {
        e.preventDefault();
        setShowAppSettings((prev) => !prev);
        return;
      }
      // Cmd+N: New agent
      if (mod && e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        setShowNewAgent(true);
        return;
      }
      // Cmd+B: Toggle sidebar
      if (mod && e.key === "b") {
        e.preventDefault();
        setSidebarVisible((prev) => !prev);
        return;
      }
      // Cmd+Shift+A: All agents dashboard
      if (mod && e.shiftKey && e.key === "A") {
        e.preventDefault();
        setMainView("dashboard");
        return;
      }
      // Cmd+Shift+D: Toggle diff (split) view
      if (mod && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setMainView((prev) => (prev === "split" ? "thread" : "split"));
        return;
      }
      // Cmd+/: Show keyboard shortcuts help
      if (mod && e.key === "/") {
        e.preventDefault();
        setShowShortcutsHelp((prev) => !prev);
        return;
      }
      // Cmd+1..9: Switch between threads
      if (mod && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = Number(e.key) - 1;
        if (index < threads.length) {
          setActiveThread(threads[index].id);
          setMainView("thread");
        }
        return;
      }
      // Escape: Cancel current agent or close modals
      if (e.key === "Escape") {
        if (showCommandBar) { setShowCommandBar(false); return; }
        if (showAppSettings) { setShowAppSettings(false); return; }
        if (showNewAgent) { setShowNewAgent(false); return; }
        if (showShortcutsHelp) { setShowShortcutsHelp(false); return; }
        // Cancel the active running agent
        if (activeThreadId) {
          const activeThread = threads.find((t) => t.id === activeThreadId);
          if (activeThread?.status === "running") {
            cancelAgent(activeThreadId);
          }
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [threads, activeThreadId, showCommandBar, showAppSettings, showNewAgent, showShortcutsHelp, setActiveThread, cancelAgent]);

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
    { key: "terminal", label: "Term" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
      {sidebarVisible && <Sidebar />}

      <div className="flex-1 flex flex-col min-h-0">
        {/* Top bar */}
        {activeProjectId && (
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border flex-shrink-0">
            <button
              onClick={() => setShowProjectSettings(true)}
              className="flex-shrink-0 px-2.5 py-1 rounded border border-border text-xs text-foreground hover:bg-accent"
            >
              Project
            </button>
            <button
              onClick={() => setShowAppSettings(true)}
              className="flex-shrink-0 px-2.5 py-1 rounded border border-border text-xs text-foreground hover:bg-accent"
              title="Ctrl+,"
            >
              Settings
            </button>
            <div className="flex rounded border border-border overflow-hidden">
              {viewButtons.map((btn, i) => (
                <button
                  key={btn.key}
                  onClick={() => setMainView(btn.key)}
                  className={`px-2 py-1 text-[11px] font-medium transition-colors ${
                    mainView === btn.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  } ${i > 0 ? "border-l border-border" : ""}`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-0" />
            {mainView === "skills" && (
              <>
                <button
                  onClick={() => setShowSkillInstaller(true)}
                  className="flex-shrink-0 px-2 py-1 rounded border border-border text-xs text-foreground hover:bg-accent"
                >
                  Import
                </button>
                <button
                  onClick={() => {
                    setEditingSkill(null);
                    setShowSkillEditor(true);
                  }}
                  className="flex-shrink-0 px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                >
                  + Skill
                </button>
              </>
            )}
            {mainView === "automations" && (
              <>
                <button
                  onClick={() => {
                    setEditingAutomation(null);
                    setShowAutomationEditor(true);
                  }}
                  className="flex-shrink-0 px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
                >
                  + Automation
                </button>
                {activeProjectId && (
                  <button
                    onClick={() => {
                      ipc.invoke("export:automationCsv", activeProjectId).catch(console.error);
                    }}
                    className="flex-shrink-0 px-2 py-1 rounded border border-border text-xs text-foreground hover:bg-accent"
                  >
                    CSV
                  </button>
                )}
              </>
            )}
            {mainView !== "skills" && mainView !== "inbox" && mainView !== "automations" && mainView !== "terminal" && (
              <button
                onClick={() => setShowNewAgent(true)}
                className="flex-shrink-0 px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
              >
                + Agent
              </button>
            )}
            {mainView === "thread" && activeThreadId && (
              <button
                onClick={() => {
                  ipc.invoke("export:threadMarkdown", activeThreadId).catch(console.error);
                }}
                className="flex-shrink-0 px-2 py-1 rounded border border-border text-xs text-foreground hover:bg-accent"
                title="Export Markdown"
              >
                MD
              </button>
            )}
            <button
              onClick={() => {
                ipc.invoke("export:costReport", activeProjectId).catch(console.error);
              }}
              className="flex-shrink-0 px-2 py-1 rounded border border-border text-xs text-foreground hover:bg-accent"
              title="Export cost report"
            >
              $
            </button>
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
        {mainView === "terminal" && (() => {
          const activeProject = projects.find((p) => p.id === activeProjectId);
          const termCwd = activeProject?.path ?? ".";
          return (
            <div className="flex-1 overflow-hidden">
              <React.Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading terminal...</div>}>
                <EmbeddedTerminal
                  id={`project-${activeProjectId ?? "default"}`}
                  cwd={termCwd}
                  onClose={() => setMainView("thread")}
                />
              </React.Suspense>
            </div>
          );
        })()}
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

      <StatusBar activeThreadId={activeThreadId} onNotificationsClick={() => setShowNotifications(true)} />

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

      <SettingsPanel
        open={showAppSettings}
        onClose={() => setShowAppSettings(false)}
      />

      <ToastContainer />

      <NotificationCenter
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
      />

      {showShortcutsHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={() => setShowShortcutsHelp(false)} />
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Keyboard Shortcuts</h2>
            <div className="space-y-2 text-sm">
              {[
                ["Ctrl+K", "Command palette"],
                ["Ctrl+N", "New agent thread"],
                ["Ctrl+B", "Toggle sidebar"],
                ["Ctrl+,", "App settings"],
                ["Ctrl+/", "Shortcuts help"],
                ["Ctrl+1-9", "Switch threads"],
                ["Ctrl+Shift+A", "All agents dashboard"],
                ["Ctrl+Shift+D", "Toggle split view"],
                ["Ctrl+Enter", "Send message"],
                ["Escape", "Close dialog / cancel agent"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{desc}</span>
                  <kbd className="px-2 py-0.5 rounded border border-border bg-background text-xs font-mono text-foreground">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowShortcutsHelp(false)}
              className="mt-4 w-full px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
