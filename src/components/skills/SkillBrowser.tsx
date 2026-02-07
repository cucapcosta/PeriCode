import React, { useEffect, useState, useMemo } from "react";
import { ipc } from "@/lib/ipc-client";
import type { Skill, SkillDetail } from "@/types/ipc";

type ScopeFilter = "all" | "system" | "user" | "project";
type ViewMode = "grid" | "list";

interface SkillBrowserProps {
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onSelect?: (skill: Skill) => void;
}

export const SkillBrowser: React.FC<SkillBrowserProps> = ({
  onEdit,
  onDelete,
  onSelect,
}) => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [previewSkill, setPreviewSkill] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImportGit, setShowImportGit] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    loadSkills();
  }, []);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const result = await ipc.invoke("skill:list");
      setSkills(result);
    } catch (err) {
      console.error("Failed to load skills:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredSkills = useMemo(() => {
    let filtered = skills;

    if (scopeFilter !== "all") {
      filtered = filtered.filter((s) => s.scope === scopeFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [skills, scopeFilter, search]);

  const handlePreview = async (skill: Skill) => {
    try {
      const detail = await ipc.invoke("skill:get", skill.id);
      setPreviewSkill(detail);
    } catch (err) {
      console.error("Failed to load skill detail:", err);
    }
  };

  const handleDelete = async (skill: Skill) => {
    try {
      await ipc.invoke("skill:delete", skill.id);
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      onDelete?.(skill);
    } catch (err) {
      console.error("Failed to delete skill:", err);
    }
  };

  const handleImportFromGit = async () => {
    if (!gitUrl.trim()) return;

    setImporting(true);
    setImportError(null);

    try {
      const importedSkills = await ipc.invoke("skill:importFromGit", gitUrl.trim());
      setSkills((prev) => [...importedSkills, ...prev]);
      setShowImportGit(false);
      setGitUrl("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import skills");
    } finally {
      setImporting(false);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading skills...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex rounded-lg border border-border overflow-hidden">
          {(["all", "system", "user", "project"] as ScopeFilter[]).map((scope) => (
            <button
              key={scope}
              onClick={() => setScopeFilter(scope)}
              className={`px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                scopeFilter === scope
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              } ${scope !== "all" ? "border-l border-border" : ""}`}
            >
              {scope}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === "grid"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            Grid
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-2.5 py-1 text-xs font-medium transition-colors border-l border-border ${
              viewMode === "list"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            }`}
          >
            List
          </button>
        </div>

        <button
          onClick={() => setShowImportGit(true)}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          Import from Git
        </button>
      </div>

      {/* Skills content */}
      <div className="flex-1 overflow-auto p-4">
        {filteredSkills.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            {search ? "No skills match your search" : "No skills available"}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredSkills.map((skill) => (
              <div
                key={skill.id}
                className="border border-border rounded-lg p-4 hover:border-primary/50 transition-colors cursor-pointer group"
                onClick={() => onSelect?.(skill)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {skill.name}
                  </h3>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${scopeBadgeColor(skill.scope)}`}
                  >
                    {skill.scope}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                  {skill.description}
                </p>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(skill);
                    }}
                    className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80"
                  >
                    Preview
                  </button>
                  {skill.scope !== "system" && onEdit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(skill);
                      }}
                      className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80"
                    >
                      Edit
                    </button>
                  )}
                  {skill.scope !== "system" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(skill);
                      }}
                      className="px-2 py-1 rounded text-[10px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors cursor-pointer group"
                onClick={() => onSelect?.(skill)}
              >
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${scopeBadgeColor(skill.scope)}`}
                >
                  {skill.scope}
                </span>
                <span className="text-sm font-medium text-foreground min-w-[140px]">
                  {skill.name}
                </span>
                <span className="text-xs text-muted-foreground flex-1 truncate">
                  {skill.description}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(skill);
                    }}
                    className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80"
                  >
                    Preview
                  </button>
                  {skill.scope !== "system" && onEdit && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(skill);
                      }}
                      className="px-2 py-1 rounded text-[10px] font-medium text-foreground bg-accent hover:bg-accent/80"
                    >
                      Edit
                    </button>
                  )}
                  {skill.scope !== "system" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(skill);
                      }}
                      className="px-2 py-1 rounded text-[10px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import from Git modal */}
      {showImportGit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => !importing && setShowImportGit(false)}
          />
          <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">
                Import Skill from Git
              </h2>
              <button
                onClick={() => !importing && setShowImportGit(false)}
                className="text-muted-foreground hover:text-foreground text-lg"
                disabled={importing}
              >
                x
              </button>
            </div>
            <div className="px-6 py-4">
              <p className="text-sm text-muted-foreground mb-4">
                Enter a Git repository URL containing SKILL.md files. The repository will be cloned to your skills directory.
              </p>
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/user/skill-repo.git"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={importing}
                onKeyDown={(e) => e.key === "Enter" && handleImportFromGit()}
              />
              {importError && (
                <p className="text-sm text-destructive mt-2">{importError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <button
                onClick={() => setShowImportGit(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors"
                disabled={importing}
              >
                Cancel
              </button>
              <button
                onClick={handleImportFromGit}
                disabled={!gitUrl.trim() || importing}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview panel */}
      {previewSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setPreviewSkill(null)}
          />
          <div className="relative bg-card border border-border rounded-xl shadow-lg w-full max-w-[calc(100%-1rem)] sm:max-w-xl md:max-w-2xl mx-2 sm:mx-4 max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  {previewSkill.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {previewSkill.description}
                </p>
              </div>
              <button
                onClick={() => setPreviewSkill(null)}
                className="text-muted-foreground hover:text-foreground text-lg"
              >
                x
              </button>
            </div>
            <div className="flex gap-3 px-6 py-3 border-b border-border text-xs text-muted-foreground">
              {previewSkill.model && (
                <span>
                  Model: <strong className="text-foreground">{previewSkill.model}</strong>
                </span>
              )}
              {previewSkill.tools && previewSkill.tools.length > 0 && (
                <span>
                  Tools: <strong className="text-foreground">{previewSkill.tools.join(", ")}</strong>
                </span>
              )}
              {previewSkill.maxBudgetUsd !== undefined && (
                <span>
                  Budget: <strong className="text-foreground">${previewSkill.maxBudgetUsd}</strong>
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed">
                {previewSkill.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
