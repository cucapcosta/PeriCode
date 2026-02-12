import React, { useState, useEffect } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useProjectStore } from "@/stores/projectStore";
import { ipc } from "@/lib/ipc-client";
import { getLatestModels, formatContextWindow, type ModelDefinition } from "@/lib/models";
import type { Skill, AppSettings, ProviderType, ModelInfo } from "@/types/ipc";
import { Button } from "@/components/ui/Button";

const CloseIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

interface ToolOption {
  name: string;
  label: string;
  description: string;
  risky: boolean;
}

const AVAILABLE_TOOLS: ToolOption[] = [
  { name: "Read", label: "Read", description: "Read files", risky: false },
  { name: "Glob", label: "Glob", description: "Find files by pattern", risky: false },
  { name: "Grep", label: "Grep", description: "Search file contents", risky: false },
  { name: "WebSearch", label: "WebSearch", description: "Search the web", risky: false },
  { name: "WebFetch", label: "WebFetch", description: "Fetch web content", risky: false },
  { name: "Edit", label: "Edit", description: "Edit existing files", risky: true },
  { name: "Write", label: "Write", description: "Create / overwrite files", risky: true },
  { name: "Bash", label: "Bash", description: "Execute shell commands", risky: true },
];

interface NewAgentDialogProps {
  open: boolean;
  onClose: () => void;
}

export const NewAgentDialog: React.FC<NewAgentDialogProps> = ({
  open,
  onClose,
}) => {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [useWorktree, setUseWorktree] = useState(false);
  const [permissionMode, setPermissionMode] = useState<AppSettings["permissionMode"]>("ask");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    new Set(AVAILABLE_TOOLS.map((t) => t.name))
  );
  const [showToolSection, setShowToolSection] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>("claude");
  const [selectedModel, setSelectedModel] = useState<string>("sonnet");
  const [copilotModels, setCopilotModels] = useState<ModelInfo[]>([]);
  const [copilotAvailable, setCopilotAvailable] = useState(false);
  const { launchAgent } = useAgentStore();
  const { activeProjectId } = useProjectStore();
  const latestModels = getLatestModels();

  useEffect(() => {
    if (open) {
      loadSkills();
      loadSettings();
      loadCopilotModels();
    }
  }, [open]);

  const loadSkills = async () => {
    try {
      const result = await ipc.invoke("skill:list");
      setSkills(result);
    } catch (err) {
      console.error("Failed to load skills:", err);
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await ipc.invoke("settings:get");
      setPermissionMode(settings.permissionMode);

      // Check project-level overrides first
      let provider: ProviderType = settings.providers?.defaultProvider ?? "claude";
      let model: string | undefined;

      if (activeProjectId) {
        try {
          const projectSettings = await ipc.invoke("project:getSettings", activeProjectId);
          if (projectSettings.provider) {
            provider = projectSettings.provider;
            model = projectSettings.model;
          }
        } catch { /* project settings not found, use app defaults */ }
      }

      setSelectedProvider(provider);
      if (provider === "copilot") {
        setSelectedModel(model || settings.providers?.copilot?.defaultModel || "gpt-4.1");
      } else {
        setSelectedModel(model || settings.defaultModel || "sonnet");
      }
      // Auto-expand tool section so user sees what's allowed
      if (settings.permissionMode === "ask") {
        setShowToolSection(true);
      }
    } catch {
      // default stays
    }
  };

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

  const handleProviderChange = (provider: ProviderType) => {
    setSelectedProvider(provider);
    if (provider === "claude") {
      setSelectedModel("sonnet");
    } else if (provider === "copilot" && copilotModels.length > 0) {
      setSelectedModel(copilotModels[0].id);
    }
  };

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleTool = (name: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAllTools = () => {
    setSelectedTools(new Set(AVAILABLE_TOOLS.map((t) => t.name)));
  };

  const deselectAllTools = () => {
    setSelectedTools(new Set());
  };

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !activeProjectId) return;

    setLoading(true);
    try {
      await launchAgent({
        projectId: activeProjectId,
        prompt: prompt.trim(),
        provider: selectedProvider,
        model: selectedModel,
        skillIds: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
        useWorktree,
        allowedTools:
          permissionMode === "ask" && selectedTools.size > 0
            ? Array.from(selectedTools)
            : undefined,
      });
      setPrompt("");
      setSelectedSkillIds([]);
      setUseWorktree(false);
      setSelectedTools(
        new Set(AVAILABLE_TOOLS.map((t) => t.name))
      );
      setShowToolSection(false);
      onClose();
    } catch (err) {
      console.error("Failed to launch agent:", err);
    } finally {
      setLoading(false);
    }
  };

  const scopeBadgeColor = (scope: Skill["scope"]) => {
    switch (scope) {
      case "system":
        return "bg-blue-500/20 text-blue-400";
      case "user":
        return "bg-green-500/20 text-green-400";
      case "project":
        return "bg-purple-500/20 text-purple-400";
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
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-[calc(100%-2rem)] sm:max-w-md md:max-w-lg mx-2 sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            New Agent
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mb-4">
            <label
              htmlFor="prompt"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Prompt
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the task for the agent..."
              rows={6}
              className="w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>

          {/* Provider & Model selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-foreground mb-2">
              Provider
            </label>
            <div className="flex gap-2 mb-3">
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

            <label className="block text-sm font-medium text-foreground mb-2">
              Model
            </label>
            {selectedProvider === "claude" ? (
              <div className="flex gap-2">
                {latestModels.map((model) => (
                  <ModelChip
                    key={model.id}
                    model={model}
                    selected={selectedModel === model.alias}
                    onClick={() => setSelectedModel(model.alias)}
                  />
                ))}
              </div>
            ) : (
              <>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm"
                >
                  {copilotModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.description ? ` — ${m.description}` : ""}
                    </option>
                  ))}
                </select>
                {(() => {
                  const sel = copilotModels.find((m) => m.id === selectedModel);
                  if (!sel) return null;
                  const pm = sel.premiumMultiplier;
                  const label = pm === 0 ? "Free" : pm != null ? `${pm}x premium (~$${(pm * 0.04).toFixed(pm < 1 ? 3 : 2)}/req)` : null;
                  if (!label) return null;
                  return (
                    <p className={`text-xs mt-1.5 ${pm === 0 ? "text-green-400" : (pm ?? 1) >= 3 ? "text-orange-400" : "text-muted-foreground"}`}>
                      {label}{sel.responsesApi ? " · Responses API" : ""}
                    </p>
                  );
                })()}
              </>
            )}
          </div>

          {/* Skills selector */}
          {skills.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-2">
                Skills
              </label>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggleSkill(skill.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      selectedSkillIds.includes(skill.id)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${scopeBadgeColor(skill.scope)}`}
                    />
                    {skill.name}
                  </button>
                ))}
              </div>
              {selectedSkillIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedSkillIds.length} skill{selectedSkillIds.length !== 1 ? "s" : ""} selected
                </p>
              )}
            </div>
          )}

          {/* Tool selection (only when permission mode is "ask") */}
          {permissionMode === "ask" && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowToolSection(!showToolSection)}
                className="flex items-center gap-2 text-sm font-medium text-foreground mb-2"
              >
                <span
                  className="text-xs transition-transform"
                  style={{ transform: showToolSection ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  &#9654;
                </span>
                Allowed Tools
                <span className="text-xs text-muted-foreground font-normal">
                  ({selectedTools.size}/{AVAILABLE_TOOLS.length})
                </span>
              </button>

              {showToolSection && (
                <div className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <button
                      type="button"
                      onClick={selectAllTools}
                      className="text-xs text-primary hover:underline"
                    >
                      Select all
                    </button>
                    <span className="text-muted-foreground text-xs">|</span>
                    <button
                      type="button"
                      onClick={deselectAllTools}
                      className="text-xs text-primary hover:underline"
                    >
                      Deselect all
                    </button>
                  </div>

                  {AVAILABLE_TOOLS.map((tool) => (
                    <label
                      key={tool.name}
                      className="flex items-center gap-2 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTools.has(tool.name)}
                        onChange={() => toggleTool(tool.name)}
                        className="rounded border-border"
                      />
                      <span className="text-sm text-foreground font-medium font-mono">
                        {tool.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {tool.description}
                      </span>
                      {tool.risky && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">
                          risky
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Worktree option */}
          <div className="mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useWorktree}
                onChange={(e) => setUseWorktree(e.target.checked)}
                className="rounded border-border focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-foreground">
                Use isolated worktree
              </span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-4 sm:px-6 py-4 border-t border-border bg-muted/30">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!prompt.trim() || !activeProjectId || loading}
              loading={loading}
            >
              Launch Agent
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Model selection chip component
const ModelChip: React.FC<{
  model: ModelDefinition;
  selected: boolean;
  onClick: () => void;
}> = ({ model, selected, onClick }) => {
  const familyColor = () => {
    switch (model.family) {
      case "opus": return selected
        ? "bg-purple-500 text-white border-purple-500"
        : "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20";
      case "sonnet": return selected
        ? "bg-blue-500 text-white border-blue-500"
        : "bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20";
      case "haiku": return selected
        ? "bg-green-500 text-white border-green-500"
        : "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20";
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 rounded-lg border text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${familyColor()}`}
    >
      <div className="text-sm font-semibold">{model.family.charAt(0).toUpperCase() + model.family.slice(1)}</div>
      <div className={`text-xs ${selected ? "text-white/80" : "text-muted-foreground"}`}>
        {model.version} · {formatContextWindow(model.contextWindow)}
      </div>
    </button>
  );
};
