import React, { useState, useEffect } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useProjectStore } from "@/stores/projectStore";
import { ipc } from "@/lib/ipc-client";
import type { Skill } from "@/types/ipc";

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
  const { launchAgent } = useAgentStore();
  const { activeProjectId } = useProjectStore();

  useEffect(() => {
    if (open) {
      loadSkills();
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

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
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
      });
      setPrompt("");
      setSelectedSkillIds([]);
      setUseWorktree(false);
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
      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-lg mx-4 p-6">
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
