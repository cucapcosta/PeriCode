import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import { getLatestModels, formatContextWindow, type ModelDefinition } from "@/lib/models";
import type { ProjectSettings as ProjectSettingsType, ProviderType, ModelInfo } from "@/types/ipc";

interface ProjectSettingsProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

/** $0.04 USD per 1x premium request */
const PREMIUM_REQUEST_USD = 0.04;

function formatMultiplier(m: number | undefined): string {
  if (m === undefined || m === null) return "";
  if (m === 0) return "Free";
  if (m < 1) return `${m}x (~$${(m * PREMIUM_REQUEST_USD).toFixed(3)}/req)`;
  return `${m}x (~$${(m * PREMIUM_REQUEST_USD).toFixed(2)}/req)`;
}

export const ProjectSettings: React.FC<ProjectSettingsProps> = ({
  projectId,
  open,
  onClose,
}) => {
  const [settings, setSettings] = useState<ProjectSettingsType>({});
  const [saving, setSaving] = useState(false);
  const [copilotModels, setCopilotModels] = useState<ModelInfo[]>([]);
  const [copilotAvailable, setCopilotAvailable] = useState(false);

  const latestModels = getLatestModels();
  const selectedProvider: ProviderType = settings.provider ?? "claude";

  useEffect(() => {
    if (open && projectId) {
      ipc
        .invoke("project:getSettings", projectId)
        .then(setSettings)
        .catch(console.error);
      loadCopilotModels();
    }
  }, [open, projectId]);

  const loadCopilotModels = async () => {
    try {
      const providers = await ipc.invoke("provider:list");
      const copilot = providers.find((p) => p.id === "copilot");
      setCopilotAvailable(copilot?.available ?? false);
      if (copilot?.available) {
        const models = await ipc.invoke("provider:getModels", "copilot");
        setCopilotModels(models);
      }
    } catch {
      setCopilotAvailable(false);
    }
  };

  if (!open) return null;

  const handleProviderChange = (provider: ProviderType) => {
    if (provider === "claude") {
      setSettings({ ...settings, provider: undefined, model: undefined });
    } else {
      const defaultModel = copilotModels.length > 0 ? copilotModels[0].id : "gpt-4.1";
      setSettings({ ...settings, provider, model: defaultModel });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipc.invoke("project:updateSettings", projectId, settings);
      onClose();
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const selectedCopilotModel = copilotModels.find((m) => m.id === settings.model);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Project Settings
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="space-y-4">
            {/* Provider */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Provider
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleProviderChange("claude")}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                    selectedProvider === "claude"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent"
                  }`}
                >
                  Claude CLI
                </button>
                <button
                  type="button"
                  onClick={() => copilotAvailable && handleProviderChange("copilot")}
                  disabled={!copilotAvailable}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                    selectedProvider === "copilot"
                      ? "bg-primary text-primary-foreground border-primary"
                      : copilotAvailable
                        ? "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent"
                        : "bg-background text-muted-foreground/50 border-border/50 cursor-not-allowed"
                  }`}
                >
                  GitHub Copilot
                </button>
              </div>
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Model
              </label>
              {selectedProvider === "claude" ? (
                <select
                  value={settings.model || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, model: e.target.value || undefined })
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Default (Sonnet)</option>
                  {latestModels.map((m) => (
                    <option key={m.alias} value={m.alias}>
                      {m.name} — {formatContextWindow(m.contextWindow)}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <select
                    value={settings.model || "gpt-4.1"}
                    onChange={(e) =>
                      setSettings({ ...settings, model: e.target.value })
                    }
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {copilotModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  {/* Cost estimation */}
                  {selectedCopilotModel && (
                    <div className="mt-2 p-2.5 rounded-lg bg-accent/40 border border-border/50">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Premium requests</span>
                        <span className={`font-medium ${
                          selectedCopilotModel.premiumMultiplier === 0
                            ? "text-green-400"
                            : (selectedCopilotModel.premiumMultiplier ?? 1) >= 3
                              ? "text-orange-400"
                              : "text-foreground"
                        }`}>
                          {formatMultiplier(selectedCopilotModel.premiumMultiplier)}
                        </span>
                      </div>
                      {selectedCopilotModel.premiumMultiplier !== undefined && selectedCopilotModel.premiumMultiplier > 0 && (
                        <p className="text-[10px] text-muted-foreground/70 mt-1">
                          Each request consumes {selectedCopilotModel.premiumMultiplier}x premium request{selectedCopilotModel.premiumMultiplier !== 1 ? "s" : ""} from your Copilot quota
                        </p>
                      )}
                      {selectedCopilotModel.responsesApi && (
                        <p className="text-[10px] text-blue-400/70 mt-1">
                          Uses Responses API
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* System Prompt */}
            <div>
              <label
                htmlFor="systemPrompt"
                className="block text-sm font-medium text-foreground mb-1"
              >
                System Prompt
              </label>
              <textarea
                id="systemPrompt"
                value={settings.systemPrompt || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    systemPrompt: e.target.value || undefined,
                  })
                }
                placeholder="Custom instructions for agents in this project..."
                rows={4}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Allowed Tools */}
            <div>
              <label
                htmlFor="allowedTools"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Allowed Tools (comma-separated)
              </label>
              <input
                id="allowedTools"
                type="text"
                value={settings.allowedTools?.join(", ") || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    allowedTools: e.target.value
                      ? e.target.value.split(",").map((t) => t.trim())
                      : undefined,
                  })
                }
                placeholder="Read, Write, Bash, Glob, Grep..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Max Budget */}
            <div>
              <label
                htmlFor="maxBudget"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Max Budget per Agent (USD)
              </label>
              <input
                id="maxBudget"
                type="number"
                step="0.01"
                min="0"
                value={settings.maxBudgetUsd ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxBudgetUsd: e.target.value
                      ? parseFloat(e.target.value)
                      : undefined,
                  })
                }
                placeholder="No limit"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Max Concurrent Agents */}
            <div>
              <label
                htmlFor="maxConcurrent"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Max Concurrent Agents
              </label>
              <input
                id="maxConcurrent"
                type="number"
                min="1"
                max="10"
                value={settings.maxConcurrentAgents ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxConcurrentAgents: e.target.value
                      ? parseInt(e.target.value, 10)
                      : undefined,
                  })
                }
                placeholder="Default (3)"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Build Command */}
            <div>
              <label
                htmlFor="buildCommand"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Build Command
              </label>
              <input
                id="buildCommand"
                type="text"
                value={settings.buildCommand || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    buildCommand: e.target.value || undefined,
                  })
                }
                placeholder="npm run build"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Command to run with /build. Runs in project directory.
              </p>
            </div>

            {/* Publish Command */}
            <div>
              <label
                htmlFor="publishCommand"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Publish Command
              </label>
              <input
                id="publishCommand"
                type="text"
                value={settings.publishCommand || ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    publishCommand: e.target.value || undefined,
                  })
                }
                placeholder="pnpm release {version}"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Command to run with /publish. Use {"{version}"} as placeholder.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};
