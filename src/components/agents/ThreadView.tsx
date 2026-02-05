import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useNotesStore } from "@/stores/notesStore";
import { ActivityIndicator } from "@/components/agents/ActivityIndicator";
import { ThreadNotesPanel } from "@/components/agents/ThreadNotesPanel";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { ToolUseBlock } from "@/components/agents/ToolUseBlock";
import { ipc } from "@/lib/ipc-client";
import type { Skill, StreamingContentBlock, MessageContent, ImageAttachment } from "@/types/ipc";
import { estimateCost, getModelPricing } from "@/lib/model-pricing";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAbsoluteTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-background/80 border border-border text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
      title="Copy"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export const ThreadView: React.FC = () => {
  const {
    activeThreadId,
    messages,
    streamingContent,
    threadCosts,
    errors,
    threads,
    sendMessage,
  } = useAgentStore();
  const [input, setInput] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkills, setActiveSkills] = useState<Map<string, string[]>>(new Map());
  const [skillSuggestions, setSkillSuggestions] = useState<Skill[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userIsNearBottomRef = useRef(true);

  const noteContent = useNotesStore((s) => activeThreadId ? s.notes.get(activeThreadId) : undefined);
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const threadMessages = activeThreadId
    ? messages.get(activeThreadId) || []
    : [];
  const streamingBlocks = activeThreadId
    ? streamingContent.get(activeThreadId) || []
    : [];
  const threadError = activeThreadId
    ? errors.get(activeThreadId) || null
    : null;
  const threadActiveSkills = activeThreadId
    ? activeSkills.get(activeThreadId) || []
    : [];
  const threadCostData = activeThreadId
    ? threadCosts.get(activeThreadId) || null
    : null;

  // Determine if the activity indicator should show
  const isRunning = activeThread?.status === "running";
  const showActivity =
    isRunning &&
    (streamingBlocks.length === 0 ||
      (streamingBlocks.length > 0 &&
        streamingBlocks[streamingBlocks.length - 1].type === "tool_use" &&
        streamingBlocks[streamingBlocks.length - 1].isComplete));

  const formatCost = (usd: number): string => {
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  };

  const formatTokens = (count: number): string => {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
  };

  const shortModelName = (modelId: string): string => {
    const m = modelId.match(/claude-(\w+)-([\d]+(?:-[\d]+)?)-\d{8}/);
    if (m) {
      const family = m[1];
      const version = m[2].replace("-", ".");
      return `${family}-${version}`;
    }
    return modelId.replace(/^claude-/, "");
  };

  // Load skills once
  useEffect(() => {
    ipc.invoke("skill:list").then(setSkills).catch(() => {});
  }, []);

  // Track if user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80;
    userIsNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Smart auto-scroll: only scroll to bottom if user is already near bottom
  useEffect(() => {
    if (userIsNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadMessages, streamingBlocks]);

  // Detect $skill-name syntax in input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    const dollarMatch = val.match(/\$(\S*)$/);
    if (dollarMatch) {
      const query = dollarMatch[1].toLowerCase();
      const matches = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.name.toLowerCase().replace(/\s+/g, "-").includes(query)
      );
      setSkillSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertSkillReference = (skill: Skill) => {
    const slugName = skill.name.toLowerCase().replace(/\s+/g, "-");
    const newInput = input.replace(/\$\S*$/, `$${slugName} `);
    setInput(newInput);
    setShowSuggestions(false);

    if (activeThreadId) {
      setActiveSkills((prev) => {
        const updated = new Map(prev);
        const current = updated.get(activeThreadId) || [];
        if (!current.includes(skill.id)) {
          updated.set(activeThreadId, [...current, skill.id]);
        }
        return updated;
      });
    }

    inputRef.current?.focus();
  };

  const detachSkill = (skillId: string) => {
    if (!activeThreadId) return;
    setActiveSkills((prev) => {
      const updated = new Map(prev);
      const current = updated.get(activeThreadId) || [];
      updated.set(
        activeThreadId,
        current.filter((id) => id !== skillId)
      );
      return updated;
    });
  };

  const getSkillById = (id: string): Skill | undefined =>
    skills.find((s) => s.id === id);

  const handleSend = async () => {
    if ((!input.trim() && attachedImages.length === 0) || !activeThreadId) return;
    const msg = input.trim() || (attachedImages.length > 0 ? "Analyze these images" : "");
    const imagePaths = attachedImages.length > 0 ? attachedImages.map((img) => img.filePath) : undefined;
    setInput("");
    setAttachedImages([]);
    setShowSuggestions(false);
    // Force scroll to bottom when sending
    userIsNearBottomRef.current = true;
    await sendMessage(activeThreadId, msg, imagePaths);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handlePickImages = async () => {
    const images = await ipc.invoke("image:pick");
    if (images) {
      setAttachedImages((prev) => [...prev, ...images]);
    }
  };

  const removeAttachedImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((f) =>
      /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(f.name)
    );

    const newAttachments: ImageAttachment[] = [];
    for (const file of imageFiles) {
      const filePath = (file as unknown as { path: string }).path;
      if (!filePath) continue;

      const base64 = await ipc.invoke("image:readBase64", filePath);
      if (base64) {
        newAttachments.push({
          filePath,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          base64Thumbnail: base64,
        });
      }
    }

    if (newAttachments.length > 0) {
      setAttachedImages((prev) => [...prev, ...newAttachments]);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newAttachments: ImageAttachment[] = [];

    for (const file of files) {
      const filePath = (file as unknown as { path: string }).path;
      if (!filePath) continue;

      const base64 = await ipc.invoke("image:readBase64", filePath);
      if (base64) {
        newAttachments.push({
          filePath,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          base64Thumbnail: base64,
        });
      }
    }

    if (newAttachments.length > 0) {
      setAttachedImages((prev) => [...prev, ...newAttachments]);
    }

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const renderContentBlock = (block: MessageContent, i: number) => (
    <div key={i}>
      {block.type === "text" && (
        <div className="group relative">
          <p className="text-sm whitespace-pre-wrap">{block.text}</p>
          {block.text && block.text.length > 50 && (
            <CopyButton text={block.text} />
          )}
        </div>
      )}
      {block.type === "tool_use" && block.toolName && (
        <ToolUseBlock toolName={block.toolName} toolInput={block.toolInput} />
      )}
      {block.type === "tool_result" && (
        <div className="group relative text-xs mt-1 p-2 bg-background/50 rounded border border-border max-h-48 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono">
            {block.toolOutput}
          </pre>
          {block.toolOutput && block.toolOutput.length > 20 && (
            <CopyButton text={block.toolOutput} />
          )}
        </div>
      )}
    </div>
  );

  const renderStreamingBlock = (block: StreamingContentBlock, i: number, isLast: boolean) => (
    <div key={block.id}>
      {block.type === "text" && (
        <div className="group relative">
          <p className="text-sm whitespace-pre-wrap">
            {block.text}
            {isLast && !block.isComplete && (
              <span className="animate-pulse">|</span>
            )}
          </p>
          {block.text && block.isComplete && block.text.length > 50 && (
            <CopyButton text={block.text} />
          )}
        </div>
      )}
      {block.type === "tool_use" && block.toolName && (
        <ToolUseBlock toolName={block.toolName} toolInput={block.toolInput} />
      )}
      {block.type === "tool_result" && (
        <div className="group relative text-xs mt-1 p-2 bg-background/50 rounded border border-border max-h-48 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono">
            {block.toolOutput}
          </pre>
          {block.toolOutput && block.toolOutput.length > 20 && (
            <CopyButton text={block.toolOutput} />
          )}
        </div>
      )}
    </div>
  );

  if (!activeThreadId || !activeThread) {
    return (
      <div className="flex-1 flex items-center justify-center animate-fade-in">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-foreground">
            Welcome to PeriCode
          </h2>
          <p className="mt-2 text-muted-foreground">
            Select a thread or create a new agent to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Thread header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-shrink-0 min-w-0">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            activeThread.status === "running"
              ? "bg-green-500 animate-pulse"
              : activeThread.status === "completed"
                ? "bg-blue-500"
                : activeThread.status === "failed"
                  ? "bg-red-500"
                  : "bg-yellow-500"
          }`}
        />
        <h2 className="text-sm font-semibold text-foreground truncate min-w-0 flex-1">
          {activeThread.title || "Untitled Thread"}
        </h2>

        {/* Active skills badges */}
        {threadActiveSkills.length > 0 && (
          <div className="flex items-center gap-1">
            {threadActiveSkills.map((skillId) => {
              const skill = getSkillById(skillId);
              if (!skill) return null;
              return (
                <span
                  key={skillId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
                >
                  {skill.name}
                  <button
                    onClick={() => detachSkill(skillId)}
                    className="text-primary/60 hover:text-primary"
                  >
                    x
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {activeThread.worktreePath && (
          <button
            onClick={() => setShowDiff(true)}
            className="flex-shrink-0 px-2 py-0.5 rounded border border-border text-xs text-foreground hover:bg-accent transition-colors"
          >
            Diff
          </button>
        )}
        <button
          onClick={() => setShowNotes((v) => !v)}
          className={`flex-shrink-0 px-2 py-0.5 rounded border text-xs transition-colors ${
            showNotes
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border text-foreground hover:bg-accent"
          }`}
          title="Anotações privadas"
        >
          Notes
          {!showNotes && noteContent && noteContent.length > 0 && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary ml-1 -mt-1" />
          )}
        </button>
        <span className="flex-shrink-0 text-xs text-muted-foreground capitalize">
          {activeThread.status}
        </span>
      </div>

      {/* Thread Notes */}
      {showNotes && activeThreadId && (
        <div className="animate-slide-in-right">
          <ThreadNotesPanel threadId={activeThreadId} />
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {threadMessages.map((msg, msgIdx) => (
          <div
            key={msg.id}
            className={`flex animate-fade-in-up ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            style={{ animationDelay: `${Math.min(msgIdx * 30, 300)}ms` }}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {/* Image attachments */}
              {msg.imagePaths && msg.imagePaths.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {msg.imagePaths.map((imgPath, i) => (
                    <div key={i} className="rounded overflow-hidden border border-white/20 max-w-[120px]">
                      <div className="text-[9px] px-1 py-0.5 bg-black/20 truncate" title={imgPath}>
                        {imgPath.replace(/\\/g, "/").split("/").pop()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {msg.content.map((block: MessageContent, i: number) =>
                renderContentBlock(block, i)
              )}
              <div className="flex items-center gap-2 mt-2">
                {/* Timestamp */}
                <span
                  className="text-[10px] opacity-50 cursor-default"
                  title={formatAbsoluteTime(msg.createdAt)}
                >
                  {relativeTime(msg.createdAt)}
                </span>
                {/* Cost info */}
                {(msg.costUsd !== null || msg.tokensIn !== null || msg.tokensOut !== null) && (
                  <span className="text-[10px] opacity-50 font-mono">
                    {msg.tokensIn !== null && msg.tokensOut !== null && (
                      <span>{msg.tokensIn.toLocaleString()}in / {msg.tokensOut.toLocaleString()}out</span>
                    )}
                    {msg.costUsd !== null && (
                      <span>{msg.tokensIn !== null ? " · " : ""}${msg.costUsd.toFixed(4)}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming content blocks */}
        {streamingBlocks.length > 0 && (
          <div className="flex justify-start animate-fade-in">
            <div className="max-w-[80%] rounded-lg px-4 py-3 bg-muted text-foreground">
              {streamingBlocks.map((block, i) =>
                renderStreamingBlock(block, i, i === streamingBlocks.length - 1)
              )}
            </div>
          </div>
        )}

        {/* Activity indicator */}
        {showActivity && <ActivityIndicator />}

        {/* Error banner */}
        {threadError && activeThread?.status === "failed" && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 animate-fade-in-up">
            <p className="text-sm font-medium text-red-400">Agent Error</p>
            <p className="text-sm text-red-300/80 mt-1 whitespace-pre-wrap font-mono">
              {threadError}
            </p>
          </div>
        )}

        {/* Thread cost summary */}
        {threadCostData && (activeThread.status === "completed" || activeThread.status === "failed") && threadCostData.totalCostUsd > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 animate-fade-in-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">Usage Summary</span>
              <div className="flex items-center gap-2 text-xs font-mono font-semibold">
                <span className="text-foreground" title="CLI reported">
                  {formatCost(threadCostData.totalCostUsd)}
                </span>
                <span className="text-muted-foreground/50">|</span>
                <span className="text-blue-400" title="Calculated from pricing">
                  {formatCost(
                    Object.entries(threadCostData.modelUsage).reduce(
                      (sum, [model, u]) =>
                        sum + estimateCost(model, u.inputTokens, u.outputTokens, u.cacheCreationInputTokens, u.cacheReadInputTokens),
                      0
                    )
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
              <span className="font-mono">
                {formatTokens(threadCostData.totalTokensIn)} in
              </span>
              <span className="font-mono">
                {formatTokens(threadCostData.totalTokensOut)} out
              </span>
              <span className="ml-auto text-[9px] text-muted-foreground/50">CLI | <span className="text-blue-400/60">Calc</span></span>
            </div>
            {Object.keys(threadCostData.modelUsage).length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-2 mt-1">
                {Object.entries(threadCostData.modelUsage)
                  .sort(([, a], [, b]) => b.costUsd - a.costUsd)
                  .map(([model, usage]) => {
                    const cacheTokens = usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
                    const pricing = getModelPricing(model);
                    const calcCost = estimateCost(
                      model,
                      usage.inputTokens,
                      usage.outputTokens,
                      usage.cacheCreationInputTokens,
                      usage.cacheReadInputTokens
                    );
                    return (
                      <div key={model} className="text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground font-medium">
                            {shortModelName(model)}
                          </span>
                          <div className="flex items-center gap-2 font-mono">
                            <span className="text-foreground">{formatCost(usage.costUsd)}</span>
                            <span className="text-muted-foreground/40">|</span>
                            <span className="text-blue-400">{formatCost(calcCost)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mt-0.5 ml-2">
                          <span>{formatTokens(usage.inputTokens)}in <span className="font-mono">${pricing.inputPerMTok}/M</span></span>
                          <span>{formatTokens(usage.outputTokens)}out <span className="font-mono">${pricing.outputPerMTok}/M</span></span>
                          {cacheTokens > 0 && (
                            <span>+{formatTokens(cacheTokens)}cache</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div
        className={`p-3 border-t relative flex-shrink-0 transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg z-10 pointer-events-none">
            <span className="text-sm font-medium text-primary">Drop images here</span>
          </div>
        )}

        {/* Skill suggestions popup */}
        {showSuggestions && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-auto animate-scale-in">
            {skillSuggestions.map((skill) => (
              <button
                key={skill.id}
                onClick={() => insertSkillReference(skill)}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2"
              >
                <span className="font-medium">${skill.name.toLowerCase().replace(/\s+/g, "-")}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {skill.description}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Attached images preview */}
        {attachedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 animate-fade-in">
            {attachedImages.map((img, i) => (
              <div
                key={`${img.filePath}-${i}`}
                className="group relative rounded-md border border-border overflow-hidden bg-card"
              >
                <img
                  src={img.base64Thumbnail}
                  alt={img.fileName}
                  className="w-16 h-16 object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
                  <span className="text-[8px] text-white truncate block" title={img.fileName}>
                    {img.fileName}
                  </span>
                  <span className="text-[7px] text-white/60">
                    {formatFileSize(img.sizeBytes)}
                  </span>
                </div>
                <button
                  onClick={() => removeAttachedImage(i)}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            onClick={handlePickImages}
            className="flex-shrink-0 px-2 py-2 rounded-lg border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Attach images"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="5" cy="6" r="1.2" stroke="currentColor" strokeWidth="1"/>
              <path d="M1.5 11L5 8L8 10.5L11 7.5L14.5 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={attachedImages.length > 0 ? "Describe the images..." : "Send a message... (type $ for skills)"}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
          />
          <button
            onClick={handleSend}
            disabled={(!input.trim() && attachedImages.length === 0) || activeThread.status === "running"}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>

      {showDiff && activeThread && (
        <DiffViewer
          thread={activeThread}
          onClose={() => setShowDiff(false)}
        />
      )}
    </div>
  );
};
