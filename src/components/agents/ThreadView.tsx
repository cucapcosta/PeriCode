import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { ipc } from "@/lib/ipc-client";
import type { StreamMessage, MessageContent } from "@/types/ipc";

export const ThreadView: React.FC = () => {
  const {
    activeThreadId,
    messages,
    streamingText,
    threads,
    sendMessage,
    handleStreamMessage,
    handleStatusChange,
  } = useAgentStore();
  const [input, setInput] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const threadMessages = activeThreadId
    ? messages.get(activeThreadId) || []
    : [];
  const currentStreamingText = activeThreadId
    ? streamingText.get(activeThreadId) || ""
    : "";

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

  useEffect(() => {
    ipc.on("agent:message", onStreamMessage);
    ipc.on("agent:status", onStatusChange);
    return () => {
      ipc.off("agent:message");
      ipc.off("agent:status");
    };
  }, [onStreamMessage, onStatusChange]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages, currentStreamingText]);

  const handleSend = async () => {
    if (!input.trim() || !activeThreadId) return;
    const msg = input.trim();
    setInput("");
    await sendMessage(activeThreadId, msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
    <div className="flex-1 flex flex-col h-full">
      {/* Thread header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            activeThread.status === "running"
              ? "bg-green-500 animate-pulse"
              : activeThread.status === "completed"
                ? "bg-blue-500"
                : activeThread.status === "failed"
                  ? "bg-red-500"
                  : "bg-yellow-500"
          }`}
        />
        <h2 className="font-semibold text-foreground truncate flex-1">
          {activeThread.title || "Untitled Thread"}
        </h2>
        {activeThread.worktreePath && (
          <button
            onClick={() => setShowDiff(true)}
            className="px-3 py-1 rounded-lg border border-border text-xs text-foreground hover:bg-accent"
          >
            View Diff
          </button>
        )}
        <span className="text-xs text-muted-foreground capitalize">
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
              {msg.content.map((block: MessageContent, i: number) => (
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
              ))}
              {msg.costUsd !== null && (
                <p className="text-xs mt-2 opacity-60">
                  Cost: ${msg.costUsd.toFixed(4)}
                </p>
              )}
            </div>
          </div>
        ))}

        {/* Streaming text */}
        {currentStreamingText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-3 bg-muted text-foreground">
              <p className="text-sm whitespace-pre-wrap">
                {currentStreamingText}
                <span className="animate-pulse">|</span>
              </p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || activeThread.status !== "completed"}
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
