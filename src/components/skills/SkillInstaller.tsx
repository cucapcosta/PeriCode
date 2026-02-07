import React, { useState } from "react";
import { ipc } from "@/lib/ipc-client";
import type { Skill } from "@/types/ipc";
import { Button } from "@/components/ui/Button";

const GitIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2v20M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

interface SkillInstallerProps {
  open: boolean;
  onClose: () => void;
  onInstalled?: (skills: Skill[]) => void;
}

export const SkillInstaller: React.FC<SkillInstallerProps> = ({
  open,
  onClose,
  onInstalled,
}) => {
  const [gitUrl, setGitUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImportGit = async () => {
    if (!gitUrl.trim()) return;

    setImporting(true);
    setError(null);

    try {
      const skills = await ipc.invoke("skill:importFromGit", gitUrl.trim());
      onInstalled?.(skills);
      setGitUrl("");
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to import skills from git";
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => !importing && onClose()}
      />

      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <GitIcon />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Import from Git
            </h2>
          </div>
          <button
            onClick={() => !importing && onClose()}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={importing}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Git Repository URL
            </label>
            <input
              type="text"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/anthropics/skills.git"
              className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow"
              disabled={importing}
              onKeyDown={(e) => e.key === "Enter" && handleImportGit()}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Clone a git repository and import all SKILL.md files found recursively.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleImportGit}
            disabled={importing || !gitUrl.trim()}
            loading={importing}
          >
            Import Skills
          </Button>
        </div>
      </div>
    </div>
  );
};
