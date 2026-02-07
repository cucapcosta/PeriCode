import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import type { Skill, SkillDetail, SkillDefinition } from "@/types/ipc";
import { Button } from "@/components/ui/Button";

const CloseIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

interface SkillEditorProps {
  open: boolean;
  onClose: () => void;
  /** Existing skill to edit (null = create new) */
  editingSkill?: Skill | null;
  onSaved?: (skill: Skill) => void;
}

type EditorTab = "form" | "raw" | "preview";

const AVAILABLE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
];

export const SkillEditor: React.FC<SkillEditorProps> = ({
  open,
  onClose,
  editingSkill,
  onSaved,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("sonnet");
  const [selectedTools, setSelectedTools] = useState<string[]>(["Read", "Glob", "Grep"]);
  const [maxBudgetUsd, setMaxBudgetUsd] = useState("0.50");
  const [instructions, setInstructions] = useState("");
  const [scope, setScope] = useState<"user" | "project">("user");
  const [activeTab, setActiveTab] = useState<EditorTab>("form");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (editingSkill) {
      loadSkillDetail(editingSkill.id);
    } else {
      resetForm();
    }
  }, [open, editingSkill]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setModel("sonnet");
    setSelectedTools(["Read", "Glob", "Grep"]);
    setMaxBudgetUsd("0.50");
    setInstructions("");
    setScope("user");
    setError(null);
  };

  const loadSkillDetail = async (id: string) => {
    try {
      const detail: SkillDetail = await ipc.invoke("skill:get", id);
      setName(detail.name);
      setDescription(detail.description);
      setModel(detail.model ?? "sonnet");
      setSelectedTools(detail.tools ?? []);
      setMaxBudgetUsd(detail.maxBudgetUsd?.toString() ?? "0.50");
      setInstructions(detail.content);
      setScope(detail.scope === "system" ? "user" : detail.scope);
    } catch (err) {
      console.error("Failed to load skill detail:", err);
      setError("Failed to load skill details");
    }
  };

  const toggleTool = (tool: string) => {
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const buildRawContent = (): string => {
    let raw = "---\n";
    raw += `name: ${name}\n`;
    raw += `description: >\n  ${description}\n`;
    raw += `model: ${model}\n`;
    if (selectedTools.length > 0) {
      raw += "tools:\n";
      for (const tool of selectedTools) {
        raw += `  - ${tool}\n`;
      }
    }
    const budget = parseFloat(maxBudgetUsd);
    if (!isNaN(budget) && budget > 0) {
      raw += `max_budget_usd: ${budget.toFixed(2)}\n`;
    }
    raw += "---\n\n";
    raw += instructions;
    return raw;
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);

    const definition: SkillDefinition = {
      name: name.trim(),
      description: description.trim(),
      content: instructions,
      scope,
      model,
      tools: selectedTools,
      maxBudgetUsd: parseFloat(maxBudgetUsd) || undefined,
    };

    try {
      let saved: Skill;
      if (editingSkill) {
        saved = await ipc.invoke("skill:update", editingSkill.id, definition);
      } else {
        saved = await ipc.invoke("skill:create", definition);
      }
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save skill";
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

      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-[calc(100%-1rem)] sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-2 sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {editingSkill ? "Edit Skill" : "New Skill"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-6">
          {(["form", "raw", "preview"] as EditorTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
              {error}
            </div>
          )}

          {activeTab === "form" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Custom Skill"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this skill does..."
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Model
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="haiku">Haiku</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="opus">Opus</option>
                  </select>
                </div>

                <div className="flex-1">
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Budget (USD)
                  </label>
                  <input
                    type="number"
                    value={maxBudgetUsd}
                    onChange={(e) => setMaxBudgetUsd(e.target.value)}
                    step="0.25"
                    min="0"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="flex-1">
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Scope
                  </label>
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value as "user" | "project")}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="user">User</option>
                    <option value="project">Project</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Tools
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_TOOLS.map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => toggleTool(tool)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selectedTools.includes(tool)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:text-foreground"
                      }`}
                    >
                      {tool}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Instructions
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="## Instructions&#10;&#10;Describe what the agent should do..."
                  rows={12}
                  className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                />
              </div>
            </div>
          )}

          {activeTab === "raw" && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                Raw SKILL.md content (read-only preview of the generated file):
              </p>
              <pre className="rounded-lg border border-input bg-background p-4 text-sm text-foreground font-mono whitespace-pre-wrap overflow-auto max-h-[50vh]">
                {buildRawContent()}
              </pre>
            </div>
          )}

          {activeTab === "preview" && (
            <div>
              <div className="mb-4 flex gap-3 text-xs text-muted-foreground">
                {model && (
                  <span>
                    Model: <strong className="text-foreground">{model}</strong>
                  </span>
                )}
                {selectedTools.length > 0 && (
                  <span>
                    Tools:{" "}
                    <strong className="text-foreground">
                      {selectedTools.join(", ")}
                    </strong>
                  </span>
                )}
                {maxBudgetUsd && (
                  <span>
                    Budget: <strong className="text-foreground">${maxBudgetUsd}</strong>
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-base font-semibold text-foreground mb-1">
                  {name || "Untitled Skill"}
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {description || "No description"}
                </p>
                <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                  {instructions || "No instructions defined"}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            loading={saving}
          >
            {editingSkill ? "Update Skill" : "Create Skill"}
          </Button>
        </div>
      </div>
    </div>
  );
};
