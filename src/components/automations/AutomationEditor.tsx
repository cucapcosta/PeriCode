import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import { useProjectStore } from "@/stores/projectStore";
import type { Automation, AutomationConfig, Skill } from "@/types/ipc";

interface AutomationEditorProps {
  open: boolean;
  onClose: () => void;
  editingAutomation?: Automation | null;
  onSaved?: (automation: Automation) => void;
}

type TriggerType = "cron" | "file_change" | "git_event" | "manual";
type SandboxPolicy = "read-only" | "workspace-write" | "full";

const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at 9am", value: "0 9 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Every Monday at 9am", value: "0 9 * * 1" },
  { label: "Custom", value: "" },
];

const GIT_EVENTS = [
  { label: "New commit", value: "commit" },
  { label: "Branch created", value: "branch_create" },
  { label: "Branch deleted", value: "branch_delete" },
  { label: "PR opened", value: "pr_open" },
  { label: "PR merged", value: "pr_merge" },
];

const TEMPLATE_VARS = [
  { name: "{{branch}}", desc: "Current branch name" },
  { name: "{{changed_files}}", desc: "List of changed files" },
  { name: "{{author}}", desc: "Last commit author" },
  { name: "{{commit_message}}", desc: "Last commit message" },
  { name: "{{date}}", desc: "Current date" },
];

export const AutomationEditor: React.FC<AutomationEditorProps> = ({
  open,
  onClose,
  editingAutomation,
  onSaved,
}) => {
  const { activeProjectId } = useProjectStore();
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("manual");
  const [cronSchedule, setCronSchedule] = useState("0 9 * * *");
  const [cronPreset, setCronPreset] = useState("0 9 * * *");
  const [watchPaths, setWatchPaths] = useState("");
  const [watchGlob, setWatchGlob] = useState("**/*");
  const [gitEventType, setGitEventType] = useState("commit");
  const [sandboxPolicy, setSandboxPolicy] = useState<SandboxPolicy>("workspace-write");
  const [budgetLimit, setBudgetLimit] = useState("1.00");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadSkills();
      if (editingAutomation) {
        loadAutomation(editingAutomation);
      } else {
        resetForm();
      }
    }
  }, [open, editingAutomation]);

  const resetForm = () => {
    setName("");
    setPrompt("");
    setTriggerType("manual");
    setCronSchedule("0 9 * * *");
    setCronPreset("0 9 * * *");
    setWatchPaths("");
    setWatchGlob("**/*");
    setGitEventType("commit");
    setSandboxPolicy("workspace-write");
    setBudgetLimit("1.00");
    setSelectedSkillIds([]);
    setError(null);
  };

  const loadAutomation = (auto: Automation) => {
    setName(auto.name);
    setPrompt(auto.prompt);
    setTriggerType(auto.triggerType);
    if (auto.schedule) setCronSchedule(auto.schedule);
    if (auto.triggerConfig.paths) {
      setWatchPaths((auto.triggerConfig.paths as string[]).join(", "));
    }
    if (auto.triggerConfig.glob) {
      setWatchGlob(auto.triggerConfig.glob as string);
    }
    if (auto.triggerConfig.eventType) {
      setGitEventType(auto.triggerConfig.eventType as string);
    }
    if (auto.triggerConfig.sandboxPolicy) {
      setSandboxPolicy(auto.triggerConfig.sandboxPolicy as SandboxPolicy);
    }
    if (auto.triggerConfig.budgetLimitUsd) {
      setBudgetLimit(String(auto.triggerConfig.budgetLimitUsd));
    }
    setSelectedSkillIds(auto.skillIds);
  };

  const loadSkills = async () => {
    try {
      const result = await ipc.invoke("skill:list");
      setSkills(result);
    } catch (err) {
      console.error("Failed to load skills:", err);
    }
  };

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleCronPresetChange = (value: string) => {
    setCronPreset(value);
    if (value) {
      setCronSchedule(value);
    }
  };

  const insertTemplateVar = (varName: string) => {
    setPrompt((prev) => prev + varName);
  };

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim() || !activeProjectId) {
      setError("Name and prompt are required");
      return;
    }

    setSaving(true);
    setError(null);

    const triggerConfig: Record<string, unknown> = {
      sandboxPolicy,
      budgetLimitUsd: parseFloat(budgetLimit) || 1.0,
    };

    if (triggerType === "file_change") {
      triggerConfig.paths = watchPaths
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      triggerConfig.glob = watchGlob;
    }
    if (triggerType === "git_event") {
      triggerConfig.eventType = gitEventType;
    }

    const config: AutomationConfig = {
      projectId: activeProjectId,
      name: name.trim(),
      prompt: prompt.trim(),
      triggerType,
      triggerConfig,
      skillIds: selectedSkillIds,
      schedule: triggerType === "cron" ? cronSchedule : undefined,
      budgetLimitUsd: parseFloat(budgetLimit) || 1.0,
      sandboxPolicy,
    };

    try {
      let saved: Automation;
      if (editingAutomation) {
        saved = await ipc.invoke("automation:update", editingAutomation.id, config);
      } else {
        saved = await ipc.invoke("automation:create", config);
      }
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save automation";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-[calc(100%-1rem)] sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-2 sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {editingAutomation ? "Edit Automation" : "New Automation"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg"
          >
            x
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily Code Review"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Prompt template */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-foreground">
                Prompt Template
              </label>
              <div className="flex gap-1">
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => insertTemplateVar(v.name)}
                    title={v.desc}
                    className="px-1.5 py-0.5 rounded text-[9px] font-mono text-muted-foreground bg-accent hover:text-foreground"
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Review the code changes on {{branch}} and check for..."
              rows={6}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
            />
          </div>

          {/* Trigger type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Trigger
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden mb-3">
              {(["manual", "cron", "file_change", "git_event"] as TriggerType[]).map(
                (tt) => (
                  <button
                    key={tt}
                    type="button"
                    onClick={() => setTriggerType(tt)}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                      triggerType === tt
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    } ${tt !== "manual" ? "border-l border-border" : ""}`}
                  >
                    {tt.replace("_", " ")}
                  </button>
                )
              )}
            </div>

            {/* Trigger-specific config */}
            {triggerType === "cron" && (
              <div className="space-y-2">
                <select
                  value={cronPreset}
                  onChange={(e) => handleCronPresetChange(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {CRON_PRESETS.map((p) => (
                    <option key={p.label} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={cronSchedule}
                  onChange={(e) => {
                    setCronSchedule(e.target.value);
                    setCronPreset("");
                  }}
                  placeholder="Cron expression (e.g., 0 9 * * *)"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {triggerType === "file_change" && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={watchPaths}
                  onChange={(e) => setWatchPaths(e.target.value)}
                  placeholder="Paths to watch (comma-separated)"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <input
                  type="text"
                  value={watchGlob}
                  onChange={(e) => setWatchGlob(e.target.value)}
                  placeholder="Glob pattern (e.g., **/*.ts)"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}

            {triggerType === "git_event" && (
              <select
                value={gitEventType}
                onChange={(e) => setGitEventType(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {GIT_EVENTS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Skill attachment */}
          {skills.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Skills
              </label>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggleSkill(skill.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedSkillIds.includes(skill.id)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {skill.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sandbox + Budget */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground mb-1">
                Sandbox Policy
              </label>
              <select
                value={sandboxPolicy}
                onChange={(e) => setSandboxPolicy(e.target.value as SandboxPolicy)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="read-only">Read Only</option>
                <option value="workspace-write">Workspace Write</option>
                <option value="full">Full Access</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground mb-1">
                Budget Limit (USD)
              </label>
              <input
                type="number"
                value={budgetLimit}
                onChange={(e) => setBudgetLimit(e.target.value)}
                step="0.25"
                min="0"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !prompt.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving
              ? "Saving..."
              : editingAutomation
                ? "Update Automation"
                : "Create Automation"}
          </button>
        </div>
      </div>
    </div>
  );
};
