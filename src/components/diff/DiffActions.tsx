import React from "react";

interface DiffActionsProps {
  threadId: string;
  hasWorktree: boolean;
  onAcceptAll: () => void;
  onReject: () => void;
  onRequestChanges: () => void;
  accepting: boolean;
}

export const DiffActions: React.FC<DiffActionsProps> = ({
  hasWorktree,
  onAcceptAll,
  onReject,
  onRequestChanges,
  accepting,
}) => {
  if (!hasWorktree) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        No worktree associated with this thread.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 border-t border-border bg-card">
      <button
        onClick={onAcceptAll}
        disabled={accepting}
        className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
      >
        {accepting ? "Merging..." : "Accept All"}
      </button>
      <button
        onClick={onReject}
        disabled={accepting}
        className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
      >
        Reject
      </button>
      <button
        onClick={onRequestChanges}
        disabled={accepting}
        className="px-4 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-accent disabled:opacity-50"
      >
        Request Changes
      </button>
    </div>
  );
};
