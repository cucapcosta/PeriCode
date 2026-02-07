import React, { useState } from "react";
import { ipc } from "@/lib/ipc-client";
import { useProjectStore } from "@/stores/projectStore";

interface ToolUseBlockProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
}

// Tool Icons as SVG components
const ToolIcons: Record<string, React.FC<{ className?: string }>> = {
  Edit: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Write: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  ),
  Read: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  Bash: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  Glob: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  ),
  Grep: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  WebSearch: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  WebFetch: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  TodoWrite: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  Task: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  NotebookEdit: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
};

const DefaultIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const TOOL_LABELS: Record<string, string> = {
  Edit: "Edit File",
  Write: "Write File",
  Read: "Read File",
  Bash: "Run Command",
  Glob: "Find Files",
  Grep: "Search Content",
  WebSearch: "Web Search",
  WebFetch: "Fetch URL",
  TodoWrite: "Update Todos",
  Task: "Sub-Agent",
  NotebookEdit: "Edit Notebook",
};

const TOOL_COLORS: Record<string, string> = {
  Edit: "border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10",
  Write: "border-green-500/30 bg-green-500/5 hover:bg-green-500/10",
  Read: "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10",
  Bash: "border-orange-500/30 bg-orange-500/5 hover:bg-orange-500/10",
  Glob: "border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10",
  Grep: "border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10",
  WebSearch: "border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10",
  WebFetch: "border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10",
  TodoWrite: "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10",
  Task: "border-pink-500/30 bg-pink-500/5 hover:bg-pink-500/10",
  NotebookEdit: "border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10",
};

const TOOL_ICON_COLORS: Record<string, string> = {
  Edit: "text-yellow-400",
  Write: "text-green-400",
  Read: "text-blue-400",
  Bash: "text-orange-400",
  Glob: "text-cyan-400",
  Grep: "text-cyan-400",
  WebSearch: "text-purple-400",
  WebFetch: "text-purple-400",
  TodoWrite: "text-emerald-400",
  Task: "text-pink-400",
  NotebookEdit: "text-indigo-400",
};

// Diff types for unified diff display
interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

// Compute a simple unified diff between old and new strings
function computeUnifiedDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const result: DiffLine[] = [];

  // Simple LCS-based diff algorithm
  const lcs = computeLCS(oldLines, newLines);

  let oldIdx = 0;
  let newIdx = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const match of lcs) {
    // Add removed lines (in old but not matched yet)
    while (oldIdx < match.oldIdx) {
      result.push({ type: "removed", content: oldLines[oldIdx], oldLineNum: oldLineNum++ });
      oldIdx++;
    }
    // Add added lines (in new but not matched yet)
    while (newIdx < match.newIdx) {
      result.push({ type: "added", content: newLines[newIdx], newLineNum: newLineNum++ });
      newIdx++;
    }
    // Add unchanged line
    result.push({
      type: "unchanged",
      content: oldLines[oldIdx],
      oldLineNum: oldLineNum++,
      newLineNum: newLineNum++
    });
    oldIdx++;
    newIdx++;
  }

  // Add remaining removed lines
  while (oldIdx < oldLines.length) {
    result.push({ type: "removed", content: oldLines[oldIdx], oldLineNum: oldLineNum++ });
    oldIdx++;
  }
  // Add remaining added lines
  while (newIdx < newLines.length) {
    result.push({ type: "added", content: newLines[newIdx], newLineNum: newLineNum++ });
    newIdx++;
  }

  return result;
}

// Compute Longest Common Subsequence matches
function computeLCS(oldLines: string[], newLines: string[]): Array<{ oldIdx: number; newIdx: number }> {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find matches
  const matches: Array<{ oldIdx: number; newIdx: number }> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      matches.unshift({ oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return matches;
}

// Component to render inline character diff for a pair of lines
function InlineCharDiff({ oldLine, newLine }: { oldLine: string; newLine: string }) {
  // Find common prefix and suffix
  let prefixLen = 0;
  const minLen = Math.min(oldLine.length, newLine.length);
  while (prefixLen < minLen && oldLine[prefixLen] === newLine[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLine[oldLine.length - 1 - suffixLen] === newLine[newLine.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldChanged = oldLine.slice(prefixLen, oldLine.length - suffixLen);
  const newChanged = newLine.slice(prefixLen, newLine.length - suffixLen);
  const prefix = oldLine.slice(0, prefixLen);
  const suffix = oldLine.slice(oldLine.length - suffixLen);

  return (
    <div className="space-y-0.5">
      {/* Old line with deletion highlighted */}
      <div className="flex">
        <span className="w-6 text-right pr-2 text-red-400/60 select-none">-</span>
        <span className="flex-1 bg-red-500/10 rounded-sm px-1">
          <span className="text-red-300/70">{prefix}</span>
          <span className="bg-red-500/30 text-red-200 rounded-sm px-0.5">{oldChanged}</span>
          <span className="text-red-300/70">{suffix}</span>
        </span>
      </div>
      {/* New line with addition highlighted */}
      <div className="flex">
        <span className="w-6 text-right pr-2 text-green-400/60 select-none">+</span>
        <span className="flex-1 bg-green-500/10 rounded-sm px-1">
          <span className="text-green-300/70">{prefix}</span>
          <span className="bg-green-500/30 text-green-200 rounded-sm px-0.5">{newChanged}</span>
          <span className="text-green-300/70">{suffix}</span>
        </span>
      </div>
    </div>
  );
}

// Component to render the unified diff view
function UnifiedDiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const diffLines = computeUnifiedDiff(oldStr, newStr);

  // Group consecutive added/removed lines for inline comparison
  const groups: Array<{ type: "unchanged" | "change"; lines: DiffLine[] }> = [];
  let currentGroup: DiffLine[] = [];
  let currentType: "unchanged" | "change" | null = null;

  for (const line of diffLines) {
    const lineType = line.type === "unchanged" ? "unchanged" : "change";
    if (lineType !== currentType) {
      if (currentGroup.length > 0) {
        groups.push({ type: currentType!, lines: currentGroup });
      }
      currentGroup = [line];
      currentType = lineType;
    } else {
      currentGroup.push(line);
    }
  }
  if (currentGroup.length > 0) {
    groups.push({ type: currentType!, lines: currentGroup });
  }

  return (
    <div className="rounded-md border border-border bg-background/50 overflow-hidden">
      <div className="text-xs font-mono overflow-x-auto">
        {groups.map((group, gIdx) => {
          if (group.type === "unchanged") {
            // Show context lines (collapse if more than 3)
            const lines = group.lines;
            if (lines.length > 6) {
              return (
                <div key={gIdx}>
                  {lines.slice(0, 2).map((line, idx) => (
                    <div key={idx} className="flex hover:bg-muted/30">
                      <span className="w-8 text-right pr-2 text-muted-foreground/40 select-none border-r border-border/50">
                        {line.oldLineNum}
                      </span>
                      <span className="w-8 text-right pr-2 text-muted-foreground/40 select-none border-r border-border/50">
                        {line.newLineNum}
                      </span>
                      <span className="flex-1 pl-2 text-muted-foreground/70 whitespace-pre">{line.content || " "}</span>
                    </div>
                  ))}
                  <div className="flex bg-muted/20 text-muted-foreground/50 text-[10px] py-0.5">
                    <span className="w-8 border-r border-border/50"></span>
                    <span className="w-8 border-r border-border/50"></span>
                    <span className="flex-1 pl-2 italic">... {lines.length - 4} unchanged lines ...</span>
                  </div>
                  {lines.slice(-2).map((line, idx) => (
                    <div key={`end-${idx}`} className="flex hover:bg-muted/30">
                      <span className="w-8 text-right pr-2 text-muted-foreground/40 select-none border-r border-border/50">
                        {line.oldLineNum}
                      </span>
                      <span className="w-8 text-right pr-2 text-muted-foreground/40 select-none border-r border-border/50">
                        {line.newLineNum}
                      </span>
                      <span className="flex-1 pl-2 text-muted-foreground/70 whitespace-pre">{line.content || " "}</span>
                    </div>
                  ))}
                </div>
              );
            }
            return lines.map((line, idx) => (
              <div key={`${gIdx}-${idx}`} className="flex hover:bg-muted/30">
                <span className="w-8 text-right pr-2 text-muted-foreground/40 select-none border-r border-border/50">
                  {line.oldLineNum}
                </span>
                <span className="w-8 text-right pr-2 text-muted-foreground/40 select-none border-r border-border/50">
                  {line.newLineNum}
                </span>
                <span className="flex-1 pl-2 text-muted-foreground/70 whitespace-pre">{line.content || " "}</span>
              </div>
            ));
          } else {
            // Changed lines - pair up removals and additions for inline diff
            const removed = group.lines.filter(l => l.type === "removed");
            const added = group.lines.filter(l => l.type === "added");

            // If counts match and lines are similar, show inline diff
            if (removed.length === added.length && removed.length <= 5) {
              return (
                <div key={gIdx} className="border-l-2 border-yellow-500/50">
                  {removed.map((rmLine, idx) => {
                    const addLine = added[idx];
                    // Check if lines are similar enough for inline diff
                    const similarity = getLineSimilarity(rmLine.content, addLine.content);
                    if (similarity > 0.3) {
                      return (
                        <div key={idx} className="py-0.5">
                          <div className="flex bg-red-500/10 hover:bg-red-500/15">
                            <span className="w-8 text-right pr-2 text-red-400/60 select-none border-r border-border/50">
                              {rmLine.oldLineNum}
                            </span>
                            <span className="w-8 text-right pr-2 text-muted-foreground/30 select-none border-r border-border/50"></span>
                            <span className="w-6 text-center text-red-400 select-none">-</span>
                            <span className="flex-1 text-red-300 whitespace-pre">{highlightDiff(rmLine.content, addLine.content, "removed")}</span>
                          </div>
                          <div className="flex bg-green-500/10 hover:bg-green-500/15">
                            <span className="w-8 text-right pr-2 text-muted-foreground/30 select-none border-r border-border/50"></span>
                            <span className="w-8 text-right pr-2 text-green-400/60 select-none border-r border-border/50">
                              {addLine.newLineNum}
                            </span>
                            <span className="w-6 text-center text-green-400 select-none">+</span>
                            <span className="flex-1 text-green-300 whitespace-pre">{highlightDiff(addLine.content, rmLine.content, "added")}</span>
                          </div>
                        </div>
                      );
                    }
                    // Not similar enough, show separately
                    return (
                      <div key={idx}>
                        <div className="flex bg-red-500/10 hover:bg-red-500/15">
                          <span className="w-8 text-right pr-2 text-red-400/60 select-none border-r border-border/50">
                            {rmLine.oldLineNum}
                          </span>
                          <span className="w-8 text-right pr-2 text-muted-foreground/30 select-none border-r border-border/50"></span>
                          <span className="w-6 text-center text-red-400 select-none">-</span>
                          <span className="flex-1 text-red-300 whitespace-pre">{rmLine.content || " "}</span>
                        </div>
                        <div className="flex bg-green-500/10 hover:bg-green-500/15">
                          <span className="w-8 text-right pr-2 text-muted-foreground/30 select-none border-r border-border/50"></span>
                          <span className="w-8 text-right pr-2 text-green-400/60 select-none border-r border-border/50">
                            {addLine.newLineNum}
                          </span>
                          <span className="w-6 text-center text-green-400 select-none">+</span>
                          <span className="flex-1 text-green-300 whitespace-pre">{addLine.content || " "}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Different counts - show all removed then all added
            return (
              <div key={gIdx} className="border-l-2 border-yellow-500/50">
                {removed.map((line, idx) => (
                  <div key={`rm-${idx}`} className="flex bg-red-500/10 hover:bg-red-500/15">
                    <span className="w-8 text-right pr-2 text-red-400/60 select-none border-r border-border/50">
                      {line.oldLineNum}
                    </span>
                    <span className="w-8 text-right pr-2 text-muted-foreground/30 select-none border-r border-border/50"></span>
                    <span className="w-6 text-center text-red-400 select-none">-</span>
                    <span className="flex-1 text-red-300 whitespace-pre">{line.content || " "}</span>
                  </div>
                ))}
                {added.map((line, idx) => (
                  <div key={`add-${idx}`} className="flex bg-green-500/10 hover:bg-green-500/15">
                    <span className="w-8 text-right pr-2 text-muted-foreground/30 select-none border-r border-border/50"></span>
                    <span className="w-8 text-right pr-2 text-green-400/60 select-none border-r border-border/50">
                      {line.newLineNum}
                    </span>
                    <span className="w-6 text-center text-green-400 select-none">+</span>
                    <span className="flex-1 text-green-300 whitespace-pre">{line.content || " "}</span>
                  </div>
                ))}
              </div>
            );
          }
        })}
      </div>
    </div>
  );
}

// Calculate similarity between two strings (0-1)
function getLineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const maxLen = Math.max(a.length, b.length);
  let matches = 0;
  const minLen = Math.min(a.length, b.length);

  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }

  return matches / maxLen;
}

// Highlight the changed parts of a line
function highlightDiff(line: string, compareTo: string, type: "added" | "removed"): React.ReactNode {
  // Find common prefix
  let prefixLen = 0;
  const minLen = Math.min(line.length, compareTo.length);
  while (prefixLen < minLen && line[prefixLen] === compareTo[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    line[line.length - 1 - suffixLen] === compareTo[compareTo.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix = line.slice(0, prefixLen);
  const changed = line.slice(prefixLen, line.length - suffixLen);
  const suffix = line.slice(line.length - suffixLen);

  const highlightClass = type === "added"
    ? "bg-green-500/40 rounded-sm px-0.5"
    : "bg-red-500/40 rounded-sm px-0.5";

  return (
    <>
      {prefix}
      {changed && <span className={highlightClass}>{changed}</span>}
      {suffix}
    </>
  );
}

function extractFilePath(input: Record<string, unknown>): string | null {
  return (input.file_path as string) ?? (input.path as string) ?? null;
}

function shortenPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return parts.join("/");
  return ".../" + parts.slice(-3).join("/");
}

function formatCode(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

export const ToolUseBlock: React.FC<ToolUseBlockProps> = ({ toolName, toolInput }) => {
  const [expanded, setExpanded] = useState(false);
  const input = toolInput ?? {};
  const label = TOOL_LABELS[toolName] ?? toolName;
  const colorClass = TOOL_COLORS[toolName] ?? "border-muted-foreground/30 bg-muted/30 hover:bg-muted/50";
  const iconColor = TOOL_ICON_COLORS[toolName] ?? "text-muted-foreground";
  const IconComponent = ToolIcons[toolName] ?? DefaultIcon;

  const { projects, activeProjectId } = useProjectStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const filePath = extractFilePath(input);
  const hasFile = filePath && ["Edit", "Write", "Read", "NotebookEdit"].includes(toolName);

  const openInVSCode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filePath) {
      if (activeProject?.path) {
        ipc.invoke("worktree:openInVSCode", filePath, activeProject.path).catch(console.error);
      } else {
        ipc.invoke("worktree:openInVSCode", filePath).catch(console.error);
      }
    }
  };

  const renderDetail = () => {
    switch (toolName) {
      case "Edit": {
        const oldStr = input.old_string as string | undefined;
        const newStr = input.new_string as string | undefined;
        return (
          <div className="space-y-2">
            {filePath && (
              <div className="text-xs text-muted-foreground font-mono truncate px-1">
                {filePath}
              </div>
            )}
            {oldStr && newStr ? (
              <UnifiedDiffView oldStr={oldStr} newStr={newStr} />
            ) : (
              <>
                {oldStr && (
                  <div className="rounded-md bg-red-500/10 border border-red-500/20 p-2.5 overflow-x-auto">
                    <div className="text-[10px] text-red-400/80 font-medium mb-1 uppercase tracking-wide">Removed</div>
                    <pre className="text-xs font-mono text-red-300 whitespace-pre-wrap break-all">{oldStr}</pre>
                  </div>
                )}
                {newStr && (
                  <div className="rounded-md bg-green-500/10 border border-green-500/20 p-2.5 overflow-x-auto">
                    <div className="text-[10px] text-green-400/80 font-medium mb-1 uppercase tracking-wide">Added</div>
                    <pre className="text-xs font-mono text-green-300 whitespace-pre-wrap break-all">{newStr}</pre>
                  </div>
                )}
              </>
            )}
          </div>
        );
      }

      case "Write": {
        const content = input.content as string | undefined;
        return (
          <div className="space-y-2">
            {filePath && (
              <div className="text-xs text-muted-foreground font-mono truncate px-1">
                {filePath}
              </div>
            )}
            {content && (
              <div className="rounded-md bg-green-500/10 border border-green-500/20 p-2.5 overflow-x-auto max-h-48 overflow-y-auto">
                <pre className="text-xs font-mono text-green-300 whitespace-pre-wrap break-all">
                  {content.length > 2000 ? content.slice(0, 2000) + "\n... (truncated)" : content}
                </pre>
              </div>
            )}
          </div>
        );
      }

      case "Read": {
        return filePath ? (
          <div className="text-xs text-muted-foreground font-mono truncate px-1">
            {filePath}
          </div>
        ) : null;
      }

      case "Bash": {
        const command = input.command as string | undefined;
        const description = input.description as string | undefined;
        return (
          <div className="space-y-2">
            {description && (
              <div className="text-xs text-muted-foreground px-1">{description}</div>
            )}
            {command && (
              <div className="rounded-md bg-background/80 border border-border p-2.5 overflow-x-auto">
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all">
                  <span className="text-orange-400">$</span> {command}
                </pre>
              </div>
            )}
          </div>
        );
      }

      case "Grep": {
        const pattern = input.pattern as string | undefined;
        const path = (input.path as string) ?? ".";
        const glob = input.glob as string | undefined;
        return (
          <div className="rounded-md bg-background/80 border border-border p-2.5 overflow-x-auto">
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all">
              <span className="text-cyan-400">grep</span> {pattern ? `"${pattern}"` : ""}{glob ? ` --glob=${glob}` : ""} {shortenPath(path)}
            </pre>
          </div>
        );
      }

      case "Glob": {
        const pattern = input.pattern as string | undefined;
        const path = input.path as string | undefined;
        return (
          <div className="rounded-md bg-background/80 border border-border p-2.5">
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all">
              <span className="text-cyan-400">{pattern}</span>{path ? ` in ${shortenPath(path)}` : ""}
            </pre>
          </div>
        );
      }

      case "WebSearch": {
        const query = input.query as string | undefined;
        return query ? (
          <div className="text-xs text-muted-foreground px-1">
            Search: <span className="text-foreground font-medium">&quot;{query}&quot;</span>
          </div>
        ) : null;
      }

      case "Task": {
        const description = input.description as string | undefined;
        const prompt = input.prompt as string | undefined;
        return (
          <div className="space-y-2">
            {description && (
              <div className="text-xs font-medium text-foreground px-1">{description}</div>
            )}
            {prompt && expanded && (
              <div className="rounded-md bg-background/80 border border-border p-2.5 max-h-32 overflow-y-auto">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
                  {prompt.length > 1000 ? prompt.slice(0, 1000) + "\n... (truncated)" : prompt}
                </pre>
              </div>
            )}
          </div>
        );
      }

      default: {
        if (Object.keys(input).length === 0) return null;
        return (
          <div className="rounded-md bg-background/80 border border-border p-2.5 max-h-32 overflow-y-auto overflow-x-auto">
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
              {formatCode(input)}
            </pre>
          </div>
        );
      }
    }
  };

  // Summary line shown in the header
  const summaryText = (() => {
    if (toolName === "Edit" || toolName === "Write" || toolName === "Read") {
      return filePath ? shortenPath(filePath) : null;
    }
    if (toolName === "Bash") {
      const cmd = input.command as string | undefined;
      if (!cmd) return null;
      const short = cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
      return short;
    }
    if (toolName === "Grep") {
      return input.pattern as string | undefined;
    }
    if (toolName === "Glob") {
      return input.pattern as string | undefined;
    }
    if (toolName === "WebSearch") {
      return input.query as string | undefined;
    }
    if (toolName === "Task") {
      return input.description as string | undefined;
    }
    return null;
  })();

  return (
    <div className={`mt-2 rounded-lg border p-3 transition-all duration-150 ${colorClass}`}>
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 flex items-center gap-2.5 text-left min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded"
        >
          <IconComponent className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
          <span className="text-sm font-medium text-foreground">{label}</span>
          {summaryText && !expanded && (
            <span className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0 ml-1">
              {summaryText}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-muted-foreground/50 flex-shrink-0 ml-auto transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6,9 12,15 18,9" />
          </svg>
        </button>
        {hasFile && (
          <button
            onClick={openInVSCode}
            className="flex-shrink-0 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Open ${filePath} in VS Code`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.583 1L8.164 9.583 3.797 6.17 1 7.628v8.744l2.797 1.458 4.367-3.412L17.583 23l5.417-2.721V3.721L17.583 1zm-1.65 15.075l-4.505-3.541 4.505-3.541v7.082z"/>
            </svg>
          </button>
        )}
      </div>
      {expanded && <div className="mt-3">{renderDetail()}</div>}
    </div>
  );
};
