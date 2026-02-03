import React, { useState } from "react";
import { ipc } from "@/lib/ipc-client";
import type { Skill } from "@/types/ipc";

interface SkillInstallerProps {
  open: boolean;
  onClose: () => void;
  onInstalled?: (skill: Skill) => void;
}

type ImportMode = "file" | "git";

export const SkillInstaller: React.FC<SkillInstallerProps> = ({
  open,
  onClose,
  onInstalled,
}) => {
  const [mode, setMode] = useState<ImportMode>("file");
  const [filePath, setFilePath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImportFile = async () => {
    if (!filePath.trim()) return;

    setImporting(true);
    setError(null);

    try {
      const skill = await ipc.invoke("skill:import", filePath.trim());
      onInstalled?.(skill);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to import skill";
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportGit = async () => {
    if (!gitUrl.trim()) return;

    setImporting(true);
    setError(null);

    try {
      // Git import is handled via the same import endpoint
      // The backend will detect the URL and clone the repo
      const skill = await ipc.invoke("skill:import", gitUrl.trim());
      onInstalled?.(skill);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to import skill from git";
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
        onClick={onClose}
      />

      <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-lg mx-4 p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Install Skill
        </h2>

        {/* Mode tabs */}
        <div className="flex rounded-lg border border-border overflow-hidden mb-4">
          <button
            onClick={() => setMode("file")}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              mode === "file"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            From File (.zip)
          </button>
          <button
            onClick={() => setMode("git")}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-border ${
              mode === "git"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            From Git URL
          </button>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {mode === "file" ? (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Archive Path
            </label>
            <input
              type="text"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="/path/to/skill.zip"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-2"
            />
            <p className="text-xs text-muted-foreground mb-4">
              Import a skill from a .zip archive containing a SKILL.md file.
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Git Repository URL
            </label>
            <input
              type="text"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/user/skill-repo.git"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-2"
            />
            <p className="text-xs text-muted-foreground mb-4">
              Clone a skill from a git repository containing a SKILL.md file.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={mode === "file" ? handleImportFile : handleImportGit}
            disabled={
              importing || (mode === "file" ? !filePath.trim() : !gitUrl.trim())
            }
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? "Importing..." : "Import Skill"}
          </button>
        </div>
      </div>
    </div>
  );
};
