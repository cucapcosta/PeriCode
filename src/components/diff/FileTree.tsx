import React from "react";
import type { FileDiff } from "@/types/ipc";

interface FileTreeProps {
  files: FileDiff[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onOpenInVSCode?: (path: string) => void;
}

const statusIcon: Record<string, { symbol: string; className: string }> = {
  added: { symbol: "A", className: "text-green-400" },
  modified: { symbol: "M", className: "text-yellow-400" },
  deleted: { symbol: "D", className: "text-red-400" },
  renamed: { symbol: "R", className: "text-blue-400" },
};

export const FileTree: React.FC<FileTreeProps> = ({
  files,
  selectedFile,
  onSelectFile,
  onOpenInVSCode,
}) => {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="w-64 border-r border-border flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Changed Files ({files.length})
        </div>
        <div className="flex gap-2 mt-1 text-xs">
          <span className="text-green-400">+{totalAdditions}</span>
          <span className="text-red-400">-{totalDeletions}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => {
          const icon = statusIcon[file.status] ?? statusIcon.modified;
          const isSelected = selectedFile === file.path;
          return (
            <div
              key={file.path}
              className={`group flex items-center hover:bg-accent/50 transition-colors ${
                isSelected ? "bg-accent" : ""
              }`}
            >
              <button
                onClick={() => onSelectFile(file.path)}
                className="flex-1 text-left px-3 py-2 text-sm flex items-center gap-2 min-w-0"
              >
                <span className={`font-mono text-xs font-bold flex-shrink-0 ${icon.className}`}>
                  {icon.symbol}
                </span>
                <span className="truncate flex-1 text-foreground" title={file.path}>
                  {file.path.split("/").pop()}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {file.additions > 0 && (
                    <span className="text-green-400">+{file.additions}</span>
                  )}
                  {file.deletions > 0 && (
                    <span className="text-red-400 ml-1">-{file.deletions}</span>
                  )}
                </span>
              </button>
              {onOpenInVSCode && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenInVSCode(file.path);
                  }}
                  className="flex-shrink-0 px-1.5 py-1 mr-1 rounded text-[10px] text-muted-foreground/50 hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-all"
                  title={`Open ${file.path} in VS Code`}
                >
                  VS
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
