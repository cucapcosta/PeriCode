import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { ActivityIndicator } from "@/components/agents/ActivityIndicator";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { ipc } from "@/lib/ipc-client";
import type { Skill, StreamMessage, StreamingContentBlock, MessageContent, ErrorInfo } from "@/types/ipc";

export const ThreadView: React.FC = () => {
  const {
    activeThreadId,
    messages,
    streamingContent,
    threadCosts,
    errors,
    threads,
    sendMessage,
    handleStreamMessage,
    handleStatusChange,
    handleError,
  } = useAgentStore();
  const [input, setInput] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkills, setActiveSkills] = useState<Map<string, string[]>>(new Map());
  const [skillSuggestions, setSkillSuggestions] = useState<Skill[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // Listen for streaming messages
  const onStreamMessage = useCallback(
    (threadId: string, message: StreamMessage) => {
      handleStreamMessage(threadId, message);
    },
    [handleStreamMessage]
  );

  const onStatusChange = useCallback(
    (threadId: string, status: string) => {
      handleStatusChange(threadId, status);
    },
    [handleStatusChange]
  );

  const onError = useCallback(
    (threadId: string, error: ErrorInfo) => {
      handleError(threadId, error.message);
    },
    [handleError]
  );

  useEffect(() => {
    ipc.on("agent:message", onStreamMessage);
    ipc.on("agent:status", onStatusChange);
    ipc.on("agent:error", onError);
    return () => {
      ipc.off("agent:message");
      ipc.off("agent:status");
      ipc.off("agent:error");
    };
  }, [onStreamMessage, onStatusChange, onError]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    if (!input.trim() || !activeThreadId) return;
    const msg = input.trim();
    setInput("");
    setShowSuggestions(false);
    await sendMessage(activeThreadId, msg);
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

  const renderContentBlock = (block: MessageContent, i: number) => (
    <div key={i}>
      {block.type === "text" && (
        <p className="text-sm whitespace-pre-wrap">{block.text}</p>
      )}
      {block.type === "tool_use" && (
        <div className="text-xs mt-1 p-2 bg-background/50 rounded border border-border">
          <span className="font-mono font-semibold">
            {block.toolName}
          </span>
        </div>
      )}
      {block.type === "tool_result" && (
        <div className="text-xs mt-1 p-2 bg-background/50 rounded border border-border">
          <pre className="whitespace-pre-wrap font-mono">
            {block.toolOutput}
          </pre>
        </div>
      )}
    </div>
  );

  const renderStreamingBlock = (block: StreamingContentBlock, i: number, isLast: boolean) => (
    <div key={block.id}>
      {block.type === "text" && (
        <p className="text-sm whitespace-pre-wrap">
          {block.text}
          {isLast && !block.isComplete && (
            <span className="animate-pulse">|</span>
          )}
        </p>
      )}
      {block.type === "tool_use" && (
        <div className="text-xs mt-1 p-2 bg-background/50 rounded border border-border">
          <span className="font-mono font-semibold">
            {block.toolName}
          </span>
        </div>
      )}
      {block.type === "tool_result" && (
        <div className="text-xs mt-1 p-2 bg-background/50 rounded border border-border">
          <pre className="whitespace-pre-wrap font-mono">
            {block.toolOutput}
          </pre>
        </div>
      )}
    </div>
  );

  if (!activeThreadId || !activeThread) {
    return (
      <div className="flex-1 flex items-center justify-center">
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
            className="flex-shrink-0 px-2 py-0.5 rounded border border-border text-xs text-foreground hover:bg-accent"
          >
            Diff
          </button>
        )}
        <span className="flex-shrink-0 text-xs text-muted-foreground capitalize">
          {activeThread.status}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {threadMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {msg.content.map((block: MessageContent, i: number) =>
                renderContentBlock(block, i)
              )}
              {(msg.costUsd !== null || msg.tokensIn !== null || msg.tokensOut !== null) && (
                <p className="text-xs mt-2 opacity-60 font-mono">
                  {msg.tokensIn !== null && msg.tokensOut !== null && (
                    <span>{msg.tokensIn.toLocaleString()}in / {msg.tokensOut.toLocaleString()}out</span>
                  )}
                  {msg.costUsd !== null && (
                    <span>{msg.tokensIn !== null ? " \u00B7 " : ""}${msg.costUsd.toFixed(4)}</span>
                  )}
                </p>
              )}
            </div>
          </div>
        ))}

        {/* Streaming content blocks */}
        {streamingBlocks.length > 0 && (
          <div className="flex justify-start">
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
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm font-medium text-red-400">Agent Error</p>
            <p className="text-sm text-red-300/80 mt-1 whitespace-pre-wrap font-mono">
              {threadError}
            </p>
          </div>
        )}

        {/* Thread cost summary */}
        {threadCostData && (activeThread.status === "completed" || activeThread.status === "failed") && threadCostData.totalCostUsd > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">Usage Summary</span>
              <span className="text-xs font-mono font-semibold text-foreground">
                {formatCost(threadCostData.totalCostUsd)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
              <span className="font-mono">
                {formatTokens(threadCostData.totalTokensIn)} in
              </span>
              <span className="font-mono">
                {formatTokens(threadCostData.totalTokensOut)} out
              </span>
            </div>
            {Object.keys(threadCostData.modelUsage).length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-2 mt-1">
                {Object.entries(threadCostData.modelUsage)
                  .sort(([, a], [, b]) => b.costUsd - a.costUsd)
                  .map(([model, usage]) => {
                    const cacheTokens = usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
                    return (
                      <div key={model} className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground font-medium">
                          {shortModelName(model)}
                        </span>
                        <span className="font-mono text-foreground">
                          {formatTokens(usage.inputTokens)}in
                          {cacheTokens > 0 && (
                            <span className="text-muted-foreground"> +{formatTokens(cacheTokens)}cache</span>
                          )}
                          {" / "}{formatTokens(usage.outputTokens)}out
                          <span className="text-muted-foreground ml-2">{formatCost(usage.costUsd)}</span>
                        </span>
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
      <div className="p-3 border-t border-border relative flex-shrink-0">
        {/* Skill suggestions popup */}
        {showSuggestions && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-auto">
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

        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Send a message... (type $ for skills)"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || activeThread.status === "running"}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
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
