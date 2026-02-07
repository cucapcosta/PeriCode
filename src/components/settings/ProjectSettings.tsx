import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import type { ProjectSettings as ProjectSettingsType } from "@/types/ipc";

interface ProjectSettingsProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export const ProjectSettings: React.FC<ProjectSettingsProps> = ({
  projectId,
  open,
  onClose,
}) => {
  const [settings, setSettings] = useState<ProjectSettingsType>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && projectId) {
      ipc
        .invoke("project:getSettings", projectId)
        .then(setSettings)
        .catch(console.error);
    }
  }, [open, projectId]);

  if (!open) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-lg mx-4 p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Project Settings
        </h2>

        <div className="space-y-4">
          {/* Model */}
          <div>
            <label
              htmlFor="model"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Model
            </label>
            <select
              id="model"
              value={settings.model || ""}
              onChange={(e) =>
                setSettings({ ...settings, model: e.target.value || undefined })
              }
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Default</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
              <option value="haiku">Haiku</option>
            </select>
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
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6">
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
