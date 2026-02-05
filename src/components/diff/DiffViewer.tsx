import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import { useAgentStore } from "@/stores/agentStore";
import { FileTree } from "./FileTree";
import { DiffActions } from "./DiffActions";
import type { FileDiff, ThreadInfo } from "@/types/ipc";

interface DiffViewerProps {
  thread: ThreadInfo;
  onClose: () => void;
}

function computeUnifiedDiff(oldLines: string[], newLines: string[]) {
  const result: Array<{
    type: "unchanged" | "added" | "removed";
    line: string;
    oldNum: number | null;
    newNum: number | null;
  }> = [];

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // For large files, fall back to simple side-by-side
  if (m + n > 10000) {
    for (let i = 0; i < m; i++) {
      result.push({ type: "removed", line: oldLines[i], oldNum: i + 1, newNum: null });
    }
    for (let i = 0; i < n; i++) {
      result.push({ type: "added", line: newLines[i], oldNum: null, newNum: i + 1 });
    }
    return result;
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const items: typeof result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      items.push({ type: "unchanged", line: oldLines[i - 1], oldNum: i, newNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      items.push({ type: "added", line: newLines[j - 1], oldNum: null, newNum: j });
      j--;
    } else {
      items.push({ type: "removed", line: oldLines[i - 1], oldNum: i, newNum: null });
      i--;
    }
  }

  items.reverse();
  return items;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ thread, onClose }) => {
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [accepting, setAccepting] = useState(false);
  const { sendMessage } = useAgentStore();

  useEffect(() => {
    if (thread.worktreePath) {
      ipc
        .invoke("worktree:getDiff", thread.id)
        .then(setDiffs)
        .catch(console.error);
    }
  }, [thread.id, thread.worktreePath]);

  const selectedDiff = diffs.find((d) => d.path === selectedFile);

  const handleAcceptAll = async () => {
    setAccepting(true);
    try {
      await ipc.invoke("worktree:acceptAll", thread.id);
      onClose();
    } catch (err) {
      console.error("Accept all failed:", err);
    } finally {
      setAccepting(false);
    }
  };

  const handleReject = async () => {
    try {
      await ipc.invoke("worktree:reject", thread.id);
      onClose();
    } catch (err) {
      console.error("Reject failed:", err);
    }
  };

  const handleRequestChanges = () => {
    const feedback = prompt("Enter feedback for the agent:");
    if (feedback && feedback.trim()) {
      sendMessage(thread.id, feedback.trim());
      onClose();
    }
  };

  const handleOpenInEditor = async (filePath: string) => {
    try {
      await ipc.invoke("worktree:openInEditor", thread.id, filePath);
    } catch (err) {
      console.error("Open in editor failed:", err);
    }
  };

  const renderDiffContent = (diff: FileDiff) => {
    const oldLines = (diff.oldContent ?? "").split("\n");
    const newLines = (diff.newContent ?? "").split("\n");

    if (viewMode === "unified") {
      if (diff.status === "deleted") {
        return (
          <div className="font-mono text-xs overflow-auto">
            {oldLines.map((line, i) => (
              <div key={`old-${i}`} className="flex bg-red-500/10 hover:bg-red-500/20 transition-colors">
                <span className="w-12 text-right pr-2 text-red-400/60 select-none flex-shrink-0 border-r border-red-500/10">
                  {i + 1}
                </span>
                <span className="w-6 text-center text-red-400/80 select-none flex-shrink-0">-</span>
                <span className="text-red-300 whitespace-pre pl-1">{line}</span>
              </div>
            ))}
          </div>
        );
      }
      if (diff.status === "added") {
        return (
          <div className="font-mono text-xs overflow-auto">
            {newLines.map((line, i) => (
              <div key={`new-${i}`} className="flex bg-green-500/10 hover:bg-green-500/20 transition-colors">
                <span className="w-12 text-right pr-2 text-green-400/60 select-none flex-shrink-0 border-r border-green-500/10">
                  {i + 1}
                </span>
                <span className="w-6 text-center text-green-400/80 select-none flex-shrink-0">+</span>
                <span className="text-green-300 whitespace-pre pl-1">{line}</span>
              </div>
            ))}
          </div>
        );
      }

      // Modified files: compute real unified diff
      const diffLines = computeUnifiedDiff(oldLines, newLines);

      return (
        <div className="font-mono text-xs overflow-auto">
          {diffLines.map((dl, i) => {
            const bgClass =
              dl.type === "removed"
                ? "bg-red-500/10 hover:bg-red-500/20"
                : dl.type === "added"
                  ? "bg-green-500/10 hover:bg-green-500/20"
                  : "hover:bg-accent/30";
            const numColor =
              dl.type === "removed"
                ? "text-red-400/60"
                : dl.type === "added"
                  ? "text-green-400/60"
                  : "text-muted-foreground/40";
            const textColor =
              dl.type === "removed"
                ? "text-red-300"
                : dl.type === "added"
                  ? "text-green-300"
                  : "text-foreground/80";
            const sign =
              dl.type === "removed" ? "-" : dl.type === "added" ? "+" : " ";
            const signColor =
              dl.type === "removed"
                ? "text-red-400/80"
                : dl.type === "added"
                  ? "text-green-400/80"
                  : "text-transparent";

            return (
              <div key={i} className={`flex ${bgClass} transition-colors`}>
                <span className={`w-12 text-right pr-2 ${numColor} select-none flex-shrink-0 border-r border-border/30`}>
                  {dl.oldNum ?? ""}
                </span>
                <span className={`w-12 text-right pr-2 ${numColor} select-none flex-shrink-0 border-r border-border/30`}>
                  {dl.newNum ?? ""}
                </span>
                <span className={`w-6 text-center ${signColor} select-none flex-shrink-0`}>{sign}</span>
                <span className={`${textColor} whitespace-pre pl-1`}>{dl.line}</span>
              </div>
            );
          })}
        </div>
      );
    }

    // Split view
    const diffLines = computeUnifiedDiff(oldLines, newLines);
    const leftLines: Array<{ num: number | null; line: string; type: "unchanged" | "removed" | "empty" }> = [];
    const rightLines: Array<{ num: number | null; line: string; type: "unchanged" | "added" | "empty" }> = [];

    for (const dl of diffLines) {
      if (dl.type === "unchanged") {
        leftLines.push({ num: dl.oldNum, line: dl.line, type: "unchanged" });
        rightLines.push({ num: dl.newNum, line: dl.line, type: "unchanged" });
      } else if (dl.type === "removed") {
        leftLines.push({ num: dl.oldNum, line: dl.line, type: "removed" });
        rightLines.push({ num: null, line: "", type: "empty" });
      } else {
        leftLines.push({ num: null, line: "", type: "empty" });
        rightLines.push({ num: dl.newNum, line: dl.line, type: "added" });
      }
    }

    return (
      <div className="flex font-mono text-xs overflow-auto">
        <div className="flex-1 border-r border-border">
          <div className="px-3 py-1.5 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-red-500/5">
            Original
          </div>
          {leftLines.map((l, i) => {
            const bg =
              l.type === "removed"
                ? "bg-red-500/10 hover:bg-red-500/15"
                : l.type === "empty"
                  ? "bg-muted/20"
                  : "hover:bg-accent/20";
            const textColor = l.type === "removed" ? "text-red-300" : "text-foreground/80";
            const numColor = l.type === "removed" ? "text-red-400/60" : "text-muted-foreground/40";
            return (
              <div key={i} className={`flex px-1 ${bg} transition-colors`}>
                <span className={`w-10 text-right pr-2 ${numColor} select-none flex-shrink-0`}>
                  {l.num ?? ""}
                </span>
                <span className={`whitespace-pre ${textColor}`}>{l.line}</span>
              </div>
            );
          })}
        </div>
        <div className="flex-1">
          <div className="px-3 py-1.5 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-green-500/5">
            Modified
          </div>
          {rightLines.map((l, i) => {
            const bg =
              l.type === "added"
                ? "bg-green-500/10 hover:bg-green-500/15"
                : l.type === "empty"
                  ? "bg-muted/20"
                  : "hover:bg-accent/20";
            const textColor = l.type === "added" ? "text-green-300" : "text-foreground/80";
            const numColor = l.type === "added" ? "text-green-400/60" : "text-muted-foreground/40";
            return (
              <div key={i} className={`flex px-1 ${bg} transition-colors`}>
                <span className={`w-10 text-right pr-2 ${numColor} select-none flex-shrink-0`}>
                  {l.num ?? ""}
                </span>
                <span className={`whitespace-pre ${textColor}`}>{l.line}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
          <span className="text-sm font-medium text-foreground">
            Diff Review: {thread.title || "Untitled"}
          </span>
          <span className="text-xs text-muted-foreground">
            {diffs.length} file{diffs.length !== 1 ? "s" : ""} changed
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("unified")}
              className={`px-3 py-1 text-xs transition-colors ${
                viewMode === "unified"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              Unified
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`px-3 py-1 text-xs border-l border-border transition-colors ${
                viewMode === "split"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              Split
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        <FileTree
          files={diffs}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          onOpenInVSCode={(filePath) => handleOpenInEditor(filePath)}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedDiff ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-mono text-foreground truncate">
                    {selectedDiff.path}
                  </span>
                  <span className="flex-shrink-0 text-xs">
                    <span className="text-green-400">+{selectedDiff.additions}</span>
                    {" "}
                    <span className="text-red-400">-{selectedDiff.deletions}</span>
                  </span>
                </div>
                <button
                  onClick={() => handleOpenInEditor(selectedDiff.path)}
                  className="flex-shrink-0 px-2.5 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  Open in VS Code
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {selectedDiff.oldContent || selectedDiff.newContent ? (
                  renderDiffContent(selectedDiff)
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    <div>
                      <span className="text-green-400">
                        +{selectedDiff.additions}
                      </span>{" "}
                      <span className="text-red-400">
                        -{selectedDiff.deletions}
                      </span>
                      <span className="ml-2">
                        (content preview not available)
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a file to view its diff
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <DiffActions
        threadId={thread.id}
        hasWorktree={!!thread.worktreePath}
        onAcceptAll={handleAcceptAll}
        onReject={handleReject}
        onRequestChanges={handleRequestChanges}
        accepting={accepting}
      />
    </div>
  );
};
