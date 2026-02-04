import React, { useState, useEffect } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useProjectStore } from "@/stores/projectStore";
import { ipc } from "@/lib/ipc-client";
import type { Skill, AppSettings } from "@/types/ipc";

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
  const [permissionMode, setPermissionMode] = useState<AppSettings["permissionMode"]>("acceptEdits");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    new Set(AVAILABLE_TOOLS.map((t) => t.name))
  );
  const [showToolSection, setShowToolSection] = useState(false);
  const { launchAgent } = useAgentStore();
  const { activeProjectId } = useProjectStore();

  useEffect(() => {
    if (open) {
      loadSkills();
      loadSettings();
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
      // Auto-expand tool section so user sees what's allowed
      if (settings.permissionMode === "ask") {
        setShowToolSection(true);
      }
    } catch {
      // default stays
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
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          New Agent
        </h2>

        <form onSubmit={handleSubmit}>
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
                className="rounded border-border"
              />
              <span className="text-sm text-foreground">
                Use isolated worktree
              </span>
            </label>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!prompt.trim() || !activeProjectId || loading}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Launching..." : "Launch Agent"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
