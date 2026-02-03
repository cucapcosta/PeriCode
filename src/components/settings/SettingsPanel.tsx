import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import type { AppSettings } from "@/types/ipc";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "general" | "agents" | "automations" | "appearance" | "advanced";

const AVAILABLE_TOOLS = [
  "Read", "Edit", "Write", "Bash", "Glob", "Grep",
  "WebSearch", "WebFetch", "NotebookEdit",
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [apiKeyStatus, setApiKeyStatus] = useState<{ valid: boolean; provider: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    try {
      const [s, api] = await Promise.all([
        ipc.invoke("settings:get"),
        ipc.invoke("settings:getApiKeyStatus"),
      ]);
      setSettings(s);
      setApiKeyStatus(api);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const saveSettings = async (updates: Partial<AppSettings>) => {
    if (!settings) return;
    setSaving(true);
    try {
      await ipc.invoke("settings:update", updates);
      setSettings({ ...settings, ...updates });
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: "general", label: "General" },
    { key: "agents", label: "Agents" },
    { key: "automations", label: "Automations" },
    { key: "appearance", label: "Appearance" },
    { key: "advanced", label: "Advanced" },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg"
          >
            x
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border px-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {!settings ? (
            <div className="text-center text-muted-foreground py-8">Loading...</div>
          ) : (
            <>
              {activeTab === "general" && (
                <div className="space-y-6">
                  <SettingGroup label="Theme">
                    <select
                      value={settings.theme}
                      onChange={(e) => saveSettings({ theme: e.target.value as AppSettings["theme"] })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">System</option>
                    </select>
                  </SettingGroup>

                  <SettingGroup label="Default Model">
                    <select
                      value={settings.defaultModel}
                      onChange={(e) => saveSettings({ defaultModel: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="haiku">Haiku (fast)</option>
                      <option value="sonnet">Sonnet (balanced)</option>
                      <option value="opus">Opus (powerful)</option>
                    </select>
                  </SettingGroup>

                  <SettingGroup label="API Key Status">
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`inline-flex rounded-full h-2 w-2 ${
                          apiKeyStatus?.valid ? "bg-green-500" : "bg-red-500"
                        }`}
                      />
                      <span className="text-foreground">
                        {apiKeyStatus?.valid
                          ? `Connected (${apiKeyStatus.provider})`
                          : "Not configured"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Set ANTHROPIC_API_KEY environment variable to configure.
                    </p>
                  </SettingGroup>
                </div>
              )}

              {activeTab === "agents" && (
                <div className="space-y-6">
                  <SettingGroup label="Max Concurrent Agents">
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.maxConcurrentAgents}
                      onChange={(e) => saveSettings({ maxConcurrentAgents: Number(e.target.value) })}
                      className="w-24 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    />
                  </SettingGroup>

                  <SettingGroup label="Default Budget Limit (USD)">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={settings.defaultBudgetLimitUsd}
                      onChange={(e) => saveSettings({ defaultBudgetLimitUsd: Number(e.target.value) })}
                      className="w-32 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    />
                  </SettingGroup>

                  <SettingGroup label="Permission Mode">
                    <select
                      value={settings.permissionMode}
                      onChange={(e) => saveSettings({ permissionMode: e.target.value as AppSettings["permissionMode"] })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="ask">Ask - Prompt before each action</option>
                      <option value="acceptEdits">Accept Edits - Auto-approve file edits</option>
                      <option value="full">Full - Accept all actions</option>
                    </select>
                  </SettingGroup>

                  <SettingGroup label="Default Sandbox Policy">
                    <select
                      value={settings.defaultSandboxPolicy}
                      onChange={(e) => saveSettings({ defaultSandboxPolicy: e.target.value as AppSettings["defaultSandboxPolicy"] })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="read-only">Read Only</option>
                      <option value="workspace-write">Workspace Write</option>
                      <option value="full">Full Access</option>
                    </select>
                  </SettingGroup>

                  <SettingGroup label="Default Tools">
                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_TOOLS.map((tool) => {
                        const active = settings.defaultTools.includes(tool);
                        return (
                          <button
                            key={tool}
                            onClick={() => {
                              const next = active
                                ? settings.defaultTools.filter((t) => t !== tool)
                                : [...settings.defaultTools, tool];
                              saveSettings({ defaultTools: next });
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                              active
                                ? "bg-primary text-primary-foreground"
                                : "bg-accent text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {tool}
                          </button>
                        );
                      })}
                    </div>
                  </SettingGroup>
                </div>
              )}

              {activeTab === "automations" && (
                <div className="space-y-6">
                  <SettingGroup label="Enable Automations">
                    <ToggleSwitch
                      checked={settings.automationsEnabled}
                      onChange={(v) => saveSettings({ automationsEnabled: v })}
                    />
                  </SettingGroup>

                  <SettingGroup label="Notifications">
                    <div className="space-y-3">
                      <label className="flex items-center gap-3">
                        <ToggleSwitch
                          checked={settings.notifyOnCompletion}
                          onChange={(v) => saveSettings({ notifyOnCompletion: v })}
                        />
                        <span className="text-sm text-foreground">Notify on completion</span>
                      </label>
                      <label className="flex items-center gap-3">
                        <ToggleSwitch
                          checked={settings.notifyOnFailure}
                          onChange={(v) => saveSettings({ notifyOnFailure: v })}
                        />
                        <span className="text-sm text-foreground">Notify on failure</span>
                      </label>
                    </div>
                  </SettingGroup>
                </div>
              )}

              {activeTab === "appearance" && (
                <div className="space-y-6">
                  <SettingGroup label="Font Size">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={10}
                        max={20}
                        value={settings.fontSize}
                        onChange={(e) => saveSettings({ fontSize: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="text-sm text-foreground w-8 text-right">
                        {settings.fontSize}px
                      </span>
                    </div>
                  </SettingGroup>

                  <SettingGroup label="Interaction Style">
                    <select
                      value={settings.interactionStyle}
                      onChange={(e) => saveSettings({ interactionStyle: e.target.value as AppSettings["interactionStyle"] })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="terse">Terse - Brief responses</option>
                      <option value="detailed">Detailed - Verbose explanations</option>
                    </select>
                  </SettingGroup>

                  <SettingGroup label="Diff View Mode">
                    <select
                      value={settings.diffViewMode}
                      onChange={(e) => saveSettings({ diffViewMode: e.target.value as AppSettings["diffViewMode"] })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="unified">Unified</option>
                      <option value="split">Split (side-by-side)</option>
                    </select>
                  </SettingGroup>
                </div>
              )}

              {activeTab === "advanced" && (
                <div className="space-y-6">
                  <SettingGroup label="Claude CLI Path Override">
                    <input
                      type="text"
                      value={settings.claudeCliPath ?? ""}
                      placeholder="Auto-detect"
                      onChange={(e) =>
                        saveSettings({ claudeCliPath: e.target.value || null })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Leave empty to auto-detect from PATH.
                    </p>
                  </SettingGroup>

                  <SettingGroup label="Log Level">
                    <select
                      value={settings.logLevel}
                      onChange={(e) => saveSettings({ logLevel: e.target.value as AppSettings["logLevel"] })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="debug">Debug</option>
                      <option value="info">Info</option>
                      <option value="warn">Warning</option>
                      <option value="error">Error</option>
                    </select>
                  </SettingGroup>

                  <SettingGroup label="Additional Skill Directories">
                    <div className="space-y-2">
                      {settings.skillDirectories.map((dir, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={dir}
                            readOnly
                            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                          />
                          <button
                            onClick={() => {
                              const next = settings.skillDirectories.filter((_, j) => j !== i);
                              saveSettings({ skillDirectories: next });
                            }}
                            className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const path = prompt("Enter skill directory path:");
                          if (path) {
                            saveSettings({
                              skillDirectories: [...settings.skillDirectories, path],
                            });
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
                      >
                        + Add Directory
                      </button>
                    </div>
                  </SettingGroup>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {saving ? "Saving..." : "Changes saved automatically"}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Helper Components ──────────────────────────────────────────

const SettingGroup: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <label className="block text-sm font-medium text-foreground mb-2">
      {label}
    </label>
    {children}
  </div>
);

const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
}> = ({ checked, onChange }) => (
  <button
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
      checked ? "bg-primary" : "bg-muted-foreground/30"
    }`}
  >
    <span
      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
        checked ? "translate-x-4.5" : "translate-x-0.5"
      }`}
    />
  </button>
);
