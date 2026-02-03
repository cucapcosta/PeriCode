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

  // Simple diff rendering - line-by-line comparison
  const renderDiffContent = (diff: FileDiff) => {
    const oldLines = (diff.oldContent ?? "").split("\n");
    const newLines = (diff.newContent ?? "").split("\n");

    if (viewMode === "unified") {
      return (
        <div className="font-mono text-xs overflow-auto">
          {diff.status === "deleted" ? (
            oldLines.map((line, i) => (
              <div key={`old-${i}`} className="flex bg-red-500/10">
                <span className="w-12 text-right pr-2 text-red-400 select-none flex-shrink-0">
                  {i + 1}
                </span>
                <span className="text-red-300 whitespace-pre">{`- ${line}`}</span>
              </div>
            ))
          ) : diff.status === "added" ? (
            newLines.map((line, i) => (
              <div key={`new-${i}`} className="flex bg-green-500/10">
                <span className="w-12 text-right pr-2 text-green-400 select-none flex-shrink-0">
                  {i + 1}
                </span>
                <span className="text-green-300 whitespace-pre">{`+ ${line}`}</span>
              </div>
            ))
          ) : (
            // For modified files, show old and new
            <>
              {oldLines.map((line, i) => (
                <div key={`old-${i}`} className="flex bg-red-500/10">
                  <span className="w-12 text-right pr-2 text-red-400 select-none flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-red-300 whitespace-pre">{`- ${line}`}</span>
                </div>
              ))}
              {newLines.map((line, i) => (
                <div key={`new-${i}`} className="flex bg-green-500/10">
                  <span className="w-12 text-right pr-2 text-green-400 select-none flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-green-300 whitespace-pre">{`+ ${line}`}</span>
                </div>
              ))}
            </>
          )}
        </div>
      );
    }

    // Split view
    return (
      <div className="flex font-mono text-xs overflow-auto">
        <div className="flex-1 border-r border-border">
          <div className="p-2 border-b border-border text-muted-foreground">
            Original
          </div>
          {oldLines.map((line, i) => (
            <div key={`old-${i}`} className="flex px-2 bg-red-500/5">
              <span className="w-10 text-right pr-2 text-muted-foreground select-none flex-shrink-0">
                {i + 1}
              </span>
              <span className="whitespace-pre text-foreground">{line}</span>
            </div>
          ))}
        </div>
        <div className="flex-1">
          <div className="p-2 border-b border-border text-muted-foreground">
            Modified
          </div>
          {newLines.map((line, i) => (
            <div key={`new-${i}`} className="flex px-2 bg-green-500/5">
              <span className="w-10 text-right pr-2 text-muted-foreground select-none flex-shrink-0">
                {i + 1}
              </span>
              <span className="whitespace-pre text-foreground">{line}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
          <span className="text-sm font-medium text-foreground">
            Diff Review: {thread.title || "Untitled"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("unified")}
              className={`px-3 py-1 text-xs ${
                viewMode === "unified"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              Unified
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`px-3 py-1 text-xs border-l border-border ${
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
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedDiff ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
                <span className="text-sm font-mono text-foreground">
                  {selectedDiff.path}
                </span>
                <button
                  onClick={() => handleOpenInEditor(selectedDiff.path)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Open in Editor
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
