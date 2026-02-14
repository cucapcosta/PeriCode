import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import { MODELS, getLatestModels, formatContextWindow, type ModelDefinition } from "@/lib/models";
import type { AppSettings, ProviderInfo, ModelInfo, ProviderType } from "@/types/ipc";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "general" | "providers" | "agents" | "automations" | "appearance" | "advanced";

const AVAILABLE_TOOLS = [
  "Read", "Edit", "Write", "Bash", "Glob", "Grep",
  "WebSearch", "WebFetch", "NotebookEdit",
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [cliStatus, setCliStatus] = useState<{ available: boolean; version: string | null; path: string | null } | null>(null);
  const [saving, setSaving] = useState(false);

  // Provider state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [copilotModels, setCopilotModels] = useState<ModelInfo[]>([]);
  const [copilotAuth, setCopilotAuth] = useState<{ authenticated: boolean; username?: string }>({ authenticated: false });
  const [authInProgress, setAuthInProgress] = useState(false);
  const [authCode, setAuthCode] = useState<{ userCode: string; verificationUri: string } | null>(null);

  useEffect(() => {
    if (open) {
      loadSettings();
      loadProviders();
    }
  }, [open]);

  const loadSettings = async () => {
    try {
      const [s, cli] = await Promise.all([
        ipc.invoke("settings:get"),
        ipc.invoke("settings:getCliStatus"),
      ]);
      setSettings(s);
      setCliStatus(cli);
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const loadProviders = async () => {
    try {
      const [providerList, copilotStatus] = await Promise.all([
        ipc.invoke("provider:list"),
        ipc.invoke("copilot:checkAuth"),
      ]);
      setProviders(providerList);
      setCopilotAuth(copilotStatus);

      // Load Copilot models if authenticated
      if (copilotStatus.authenticated) {
        const models = await ipc.invoke("provider:getModels", "copilot");
        setCopilotModels(models);
      }
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
  };

  const startCopilotAuth = async () => {
    try {
      setAuthInProgress(true);
      const result = await ipc.invoke("copilot:startAuth") as {
        userCode: string;
        verificationUri: string;
        deviceCode: string;
        expiresIn: number;
        interval: number;
      };
      setAuthCode({ userCode: result.userCode, verificationUri: result.verificationUri });

      // Open verification URL in browser
      window.open(result.verificationUri, "_blank");

      // Poll for token
      const pollResult = await ipc.invoke("copilot:pollAuth", result.deviceCode, result.interval, result.expiresIn);
      if (pollResult.success) {
        setCopilotAuth({ authenticated: true, username: pollResult.username });
        const models = await ipc.invoke("provider:getModels", "copilot");
        setCopilotModels(models);
        // Reload settings so local state reflects the new copilot tokens
        // (prevents stale state from overwriting tokens on next save)
        const freshSettings = await ipc.invoke("settings:get");
        setSettings(freshSettings);
      }
    } catch (err) {
      console.error("Copilot auth failed:", err);
    } finally {
      setAuthInProgress(false);
      setAuthCode(null);
    }
  };

  const logoutCopilot = async () => {
    try {
      await ipc.invoke("copilot:logout");
      setCopilotAuth({ authenticated: false });
      setCopilotModels([]);
      // Reload settings so local state reflects cleared tokens
      const freshSettings = await ipc.invoke("settings:get");
      setSettings(freshSettings);
    } catch (err) {
      console.error("Copilot logout failed:", err);
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
    { key: "providers", label: "Providers" },
    { key: "agents", label: "Agents" },
    { key: "automations", label: "Automations" },
    { key: "appearance", label: "Appearance" },
    { key: "advanced", label: "Advanced" },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-[calc(100%-1rem)] sm:max-w-xl md:max-w-2xl mx-2 sm:mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg"
          >
            x
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border px-2 sm:px-6 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-2 sm:px-4 py-2 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
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
        <div className="flex-1 overflow-auto px-4 sm:px-6 py-4">
          {!settings ? (
            <div className="text-center text-muted-foreground py-8">Loading...</div>
          ) : (
            <>
              {activeTab === "general" && (
                <div className="space-y-6">
                  <SettingGroup label="Theme">
                    <ThemeSelector
                      value={settings.theme}
                      onChange={(theme) => {
                        saveSettings({ theme });
                        // Apply theme immediately
                        const root = document.documentElement;
                        if (theme === "system") {
                          const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                          root.classList.toggle("dark", prefersDark);
                        } else {
                          root.classList.toggle("dark", theme === "dark");
                        }
                      }}
                    />
                  </SettingGroup>

                  <SettingGroup label="Default Model">
                    <ModelSelector
                      value={settings.defaultModel}
                      onChange={(v) => saveSettings({ defaultModel: v })}
                    />
                  </SettingGroup>

                  <SettingGroup label="Claude CLI Status">
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`inline-flex rounded-full h-2 w-2 ${
                          cliStatus?.available ? "bg-green-500" : "bg-red-500"
                        }`}
                      />
                      <span className="text-foreground">
                        {cliStatus?.available
                          ? `Detected (${cliStatus.version ?? "unknown version"})`
                          : "Not found"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Install Claude Code CLI or set path in Advanced tab.
                    </p>
                  </SettingGroup>
                </div>
              )}

              {activeTab === "providers" && (
                <div className="space-y-6">
                  <SettingGroup label="Default Provider">
                    <select
                      value={settings.providers?.defaultProvider ?? "claude"}
                      onChange={(e) => {
                        const defaultProvider = e.target.value as ProviderType;
                        saveSettings({
                          providers: {
                            ...settings.providers,
                            defaultProvider,
                            claude: settings.providers?.claude ?? { enabled: true, defaultModel: "sonnet" },
                            copilot: settings.providers?.copilot ?? { enabled: false, authenticated: false, defaultModel: "gpt-4.1" },
                          },
                        });
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                    >
                      <option value="claude">Claude CLI</option>
                      <option value="copilot" disabled={!copilotAuth.authenticated}>
                        GitHub Copilot {!copilotAuth.authenticated && "(not connected)"}
                      </option>
                    </select>
                  </SettingGroup>

                  {/* Claude CLI Provider */}
                  <div className="p-4 rounded-lg border border-border bg-accent/30">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full h-2 w-2 ${cliStatus?.available ? "bg-green-500" : "bg-red-500"}`} />
                        <span className="font-medium text-foreground">Claude CLI</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {cliStatus?.available ? `v${cliStatus.version}` : "Not found"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Direct access to Claude via the official CLI. Supports Opus, Sonnet, and Haiku models.
                    </p>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Default Model</label>
                      <select
                        value={settings.providers?.claude?.defaultModel ?? "sonnet"}
                        onChange={(e) => {
                          saveSettings({
                            providers: {
                              ...settings.providers,
                              defaultProvider: settings.providers?.defaultProvider ?? "claude",
                              claude: {
                                ...settings.providers?.claude,
                                enabled: true,
                                defaultModel: e.target.value,
                              },
                              copilot: settings.providers?.copilot ?? { enabled: false, authenticated: false, defaultModel: "gpt-4.1" },
                            },
                          });
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                      >
                        <option value="opus">Opus 4.6 - Most capable</option>
                        <option value="sonnet">Sonnet 4.5 - Balanced</option>
                        <option value="haiku">Haiku 4.5 - Fast</option>
                      </select>
                    </div>
                  </div>

                  {/* GitHub Copilot Provider */}
                  <div className="p-4 rounded-lg border border-border bg-accent/30">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full h-2 w-2 ${copilotAuth.authenticated ? "bg-green-500" : "bg-yellow-500"}`} />
                        <span className="font-medium text-foreground">GitHub Copilot</span>
                      </div>
                      {copilotAuth.authenticated && (
                        <span className="text-xs text-green-400">@{copilotAuth.username}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Access GPT-5, Claude, Gemini, and Grok models via your GitHub Copilot subscription.
                    </p>

                    {!copilotAuth.authenticated ? (
                      <div>
                        {authCode ? (
                          <div className="p-3 rounded-lg bg-background border border-border">
                            <p className="text-sm text-foreground mb-2">
                              Enter this code on GitHub:
                            </p>
                            <div className="text-2xl font-mono font-bold text-primary text-center py-2">
                              {authCode.userCode}
                            </div>
                            <p className="text-xs text-muted-foreground text-center mt-2">
                              Waiting for authorization...
                            </p>
                          </div>
                        ) : (
                          <button
                            onClick={startCopilotAuth}
                            disabled={authInProgress}
                            className="w-full px-4 py-2 rounded-lg bg-[#24292e] text-white text-sm font-medium hover:bg-[#2f363d] disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                            </svg>
                            {authInProgress ? "Connecting..." : "Connect to GitHub"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Default Model</label>
                          <select
                            value={settings.providers?.copilot?.defaultModel ?? "gpt-4.1"}
                            onChange={(e) => {
                              saveSettings({
                                providers: {
                                  ...settings.providers,
                                  defaultProvider: settings.providers?.defaultProvider ?? "claude",
                                  claude: settings.providers?.claude ?? { enabled: true, defaultModel: "sonnet" },
                                  copilot: {
                                    ...settings.providers?.copilot,
                                    enabled: true,
                                    authenticated: true,
                                    defaultModel: e.target.value,
                                  },
                                },
                              });
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                          >
                            <optgroup label="OpenAI Codex (Responses API)">
                              <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
                              <option value="gpt-5.2-codex">GPT-5.2 Codex</option>
                              <option value="gpt-5.1-codex-max">GPT-5.1 Codex Max</option>
                              <option value="gpt-5.1-codex">GPT-5.1 Codex</option>
                              <option value="gpt-5.1-codex-mini">GPT-5.1 Codex Mini</option>
                            </optgroup>
                            <optgroup label="OpenAI">
                              <option value="gpt-5.2">GPT-5.2</option>
                              <option value="gpt-5.1">GPT-5.1</option>
                              <option value="gpt-5">GPT-5</option>
                              <option value="gpt-5-mini">GPT-5 Mini</option>
                              <option value="gpt-4.1">GPT-4.1</option>
                              <option value="gpt-4o">GPT-4o</option>
                            </optgroup>
                            <optgroup label="OpenAI Reasoning">
                              <option value="o4-mini">o4 Mini</option>
                              <option value="o3">o3</option>
                              <option value="o3-mini">o3 Mini</option>
                            </optgroup>
                            <optgroup label="Anthropic">
                              <option value="claude-opus-4.6">Claude Opus 4.6</option>
                              <option value="claude-opus-4.5">Claude Opus 4.5</option>
                              <option value="claude-sonnet-4.5">Claude Sonnet 4.5</option>
                              <option value="claude-sonnet-4">Claude Sonnet 4</option>
                              <option value="claude-haiku-4.5">Claude Haiku 4.5</option>
                            </optgroup>
                            <optgroup label="Google">
                              <option value="gemini-3-pro">Gemini 3 Pro</option>
                              <option value="gemini-3-flash">Gemini 3 Flash</option>
                              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                            </optgroup>
                            <optgroup label="xAI">
                              <option value="grok-code-fast-1">Grok Code Fast 1</option>
                            </optgroup>
                          </select>
                        </div>
                        <button
                          onClick={logoutCopilot}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Disconnect
                        </button>
                      </div>
                    )}
                  </div>
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

const ModelSelector: React.FC<{
  value: string;
  onChange: (value: string) => void;
  showAllVersions?: boolean;
}> = ({ value, onChange, showAllVersions = false }) => {
  const [expanded, setExpanded] = useState(false);
  const models = showAllVersions ? MODELS : getLatestModels();
  const selected = models.find((m) => m.alias === value) ?? models[0];

  const familyColor = (family: ModelDefinition["family"]) => {
    switch (family) {
      case "opus": return "bg-purple-500/20 text-purple-400 border-purple-500/30";
      case "sonnet": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "haiku": return "bg-green-500/20 text-green-400 border-green-500/30";
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-left flex items-center gap-3 hover:bg-accent/50 transition-colors"
      >
        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${familyColor(selected.family)}`}>
          {selected.family.toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{selected.name}</div>
          <div className="text-xs text-muted-foreground truncate">{selected.description}</div>
        </div>
        <span className="text-muted-foreground text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 overflow-hidden">
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => {
                onChange(model.alias);
                setExpanded(false);
              }}
              className={`w-full px-3 py-2.5 text-left flex items-center gap-3 hover:bg-accent transition-colors ${
                model.alias === value ? "bg-accent/50" : ""
              }`}
            >
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${familyColor(model.family)}`}>
                {model.family.toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{model.name}</span>
                  {model.isLatest && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/20 text-primary font-medium">
                      LATEST
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{model.description}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>{formatContextWindow(model.contextWindow)} ctx</div>
                <div>${model.inputPricePerMTok}/${model.outputPricePerMTok}</div>
              </div>
            </button>
          ))}
          {!showAllVersions && MODELS.length > getLatestModels().length && (
            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Could toggle to show all versions
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                + {MODELS.length - getLatestModels().length} older versions available
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ThemeSelector: React.FC<{
  value: AppSettings["theme"];
  onChange: (value: AppSettings["theme"]) => void;
}> = ({ value, onChange }) => {
  const themes: Array<{ key: AppSettings["theme"]; label: string; icon: string; description: string }> = [
    { key: "light", label: "Light", icon: "sun", description: "Pastel blue light theme" },
    { key: "dark", label: "Dark", icon: "moon", description: "Deep navy dark theme" },
    { key: "system", label: "System", icon: "auto", description: "Follow OS preference" },
  ];

  return (
    <div className="flex gap-2">
      {themes.map((theme) => (
        <button
          key={theme.key}
          type="button"
          onClick={() => onChange(theme.key)}
          className={`flex-1 px-3 py-3 rounded-lg border text-center transition-colors ${
            value === theme.key
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <div className="text-lg mb-1">
            {theme.icon === "sun" && (
              <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
            {theme.icon === "moon" && (
              <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
            {theme.icon === "auto" && (
              <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            )}
          </div>
          <div className="text-sm font-medium">{theme.label}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{theme.description}</div>
        </button>
      ))}
    </div>
  );
};
