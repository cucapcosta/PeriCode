import { create } from "zustand";
import { ipc } from "@/lib/ipc-client";
import type {
  ThreadInfo,
  Message,
  AgentLaunchConfig,
  StreamMessage,
  StreamingContentBlock,
  ModelTokenUsage,
  ErrorInfo,
} from "@/types/ipc";

interface ThreadCostState {
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  modelUsage: Record<string, ModelTokenUsage>;
}

interface PendingMessageCost {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

interface AgentState {
  threads: ThreadInfo[];
  activeThreadId: string | null;
  messages: Map<string, Message[]>;
  streamingContent: Map<string, StreamingContentBlock[]>;
  threadCosts: Map<string, ThreadCostState>;
  loading: boolean;

  loadThreads: (projectId: string) => Promise<void>;
  launchAgent: (config: AgentLaunchConfig) => Promise<ThreadInfo>;
  cancelAgent: (threadId: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  sendMessage: (threadId: string, message: string, imagePaths?: string[]) => Promise<void>;
  setActiveThread: (threadId: string | null) => void;
  loadMessages: (threadId: string) => Promise<void>;

  handleStreamMessage: (threadId: string, message: StreamMessage) => void;
  handleStatusChange: (threadId: string, status: string) => void;
  handleError: (threadId: string, errorMessage: string) => void;

  errors: Map<string, string>;
}

// Track pending cost info for the current streaming response
const pendingMessageCosts = new Map<string, PendingMessageCost>();

export const useAgentStore = create<AgentState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  messages: new Map(),
  streamingContent: new Map(),
  threadCosts: new Map(),
  errors: new Map(),
  loading: false,

  loadThreads: async (projectId: string) => {
    set({ loading: true });
    try {
      const threads = await ipc.invoke("thread:list", projectId);
      set({ threads, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  launchAgent: async (config: AgentLaunchConfig) => {
    const thread = await ipc.invoke("agent:launch", config);
    set((state) => ({
      threads: [thread, ...state.threads],
      activeThreadId: thread.id,
    }));
    const userMsg: Message = {
      id: crypto.randomUUID(),
      threadId: thread.id,
      role: "user",
      content: [{ type: "text", text: config.prompt }],
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      createdAt: new Date().toISOString(),
    };
    const msgs = new Map(get().messages);
    msgs.set(thread.id, [userMsg]);
    set({ messages: msgs });
    return thread;
  },

  cancelAgent: async (threadId: string) => {
    await ipc.invoke("agent:cancel", threadId);
  },

  deleteThread: async (threadId: string) => {
    await ipc.invoke("thread:delete", threadId);
    set((state) => {
      const threads = state.threads.filter((t) => t.id !== threadId);
      const messages = new Map(state.messages);
      messages.delete(threadId);
      const streamingContent = new Map(state.streamingContent);
      streamingContent.delete(threadId);
      const threadCosts = new Map(state.threadCosts);
      threadCosts.delete(threadId);
      const errors = new Map(state.errors);
      errors.delete(threadId);
      return {
        threads,
        messages,
        streamingContent,
        threadCosts,
        errors,
        activeThreadId:
          state.activeThreadId === threadId ? null : state.activeThreadId,
      };
    });
  },

  sendMessage: async (threadId: string, message: string, imagePaths?: string[]) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      threadId,
      role: "user",
      content: [{ type: "text", text: message }],
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      createdAt: new Date().toISOString(),
      imagePaths: imagePaths,
    };
    const msgs = new Map(get().messages);
    const existing = msgs.get(threadId) || [];
    msgs.set(threadId, [...existing, userMsg]);
    set({ messages: msgs });

    await ipc.invoke("agent:sendMessage", threadId, message, imagePaths);
  },

  setActiveThread: (threadId: string | null) => {
    set({ activeThreadId: threadId });
    if (threadId) {
      get().loadMessages(threadId);
    }
  },

  loadMessages: async (threadId: string) => {
    try {
      const threadMessages = await ipc.invoke("thread:getMessages", threadId);
      const msgs = new Map(get().messages);
      msgs.set(threadId, threadMessages);
      set({ messages: msgs });
    } catch {
      // Silently fail - messages may not exist yet
    }
  },

  handleStreamMessage: (threadId: string, message: StreamMessage) => {
    if (message.type === "text" && message.text) {
      const streaming = new Map(get().streamingContent);
      const blocks = [...(streaming.get(threadId) || [])];
      const blockIndex = message.blockIndex ?? 0;

      // Find the text block at this blockIndex
      let block = blocks.find(
        (b) => b.type === "text" && b.id === `text-${blockIndex}`
      );
      if (!block) {
        block = {
          id: `text-${blockIndex}`,
          type: "text",
          text: "",
          isComplete: false,
        };
        blocks.push(block);
      } else {
        // Clone for immutability
        const idx = blocks.indexOf(block);
        block = { ...block };
        blocks[idx] = block;
      }

      // Append the delta (orchestrator now sends deltas, not full text)
      block.text = (block.text ?? "") + message.text;

      streaming.set(threadId, blocks);
      set({ streamingContent: streaming });
    }

    if (message.type === "tool_use") {
      const streaming = new Map(get().streamingContent);
      const blocks = [...(streaming.get(threadId) || [])];
      const blockIndex = message.blockIndex ?? blocks.length;

      // Mark previous text block as complete
      for (const b of blocks) {
        if (b.type === "text" && !b.isComplete) {
          b.isComplete = true;
        }
      }

      blocks.push({
        id: `tool-${blockIndex}`,
        type: "tool_use",
        toolName: message.toolName,
        toolInput: message.toolInput,
        isComplete: true,
      });

      streaming.set(threadId, blocks);
      set({ streamingContent: streaming });
    }

    if (message.type === "tool_result") {
      const streaming = new Map(get().streamingContent);
      const blocks = [...(streaming.get(threadId) || [])];

      blocks.push({
        id: `result-${blocks.length}`,
        type: "tool_result",
        toolOutput: message.toolOutput,
        isComplete: true,
      });

      streaming.set(threadId, blocks);
      set({ streamingContent: streaming });
    }

    if (message.type === "cost") {
      const costs = new Map(get().threadCosts);
      const current = costs.get(threadId) || {
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        modelUsage: {},
      };
      const costUsd = message.costUsd ?? 0;
      const tokensIn = message.tokensIn ?? 0;
      const tokensOut = message.tokensOut ?? 0;

      current.totalCostUsd += costUsd;
      current.totalTokensIn += tokensIn;
      current.totalTokensOut += tokensOut;
      if (message.modelUsage) {
        for (const [model, usage] of Object.entries(message.modelUsage)) {
          const existing = current.modelUsage[model];
          if (existing) {
            existing.inputTokens += usage.inputTokens;
            existing.outputTokens += usage.outputTokens;
            existing.cacheReadInputTokens += usage.cacheReadInputTokens;
            existing.cacheCreationInputTokens += usage.cacheCreationInputTokens;
            existing.costUsd += usage.costUsd;
          } else {
            current.modelUsage[model] = { ...usage };
          }
        }
      }
      costs.set(threadId, { ...current });
      set({ threadCosts: costs });

      // Store the cost info for the pending message
      pendingMessageCosts.set(threadId, { costUsd, tokensIn, tokensOut });
    }

    if (message.type === "status" && (message.status === "completed" || message.status === "failed")) {
      // Promote streaming blocks to a finalized Message
      const streaming = new Map(get().streamingContent);
      const blocks = streaming.get(threadId);
      if (blocks && blocks.length > 0) {
        const content = blocks
          .filter((b) => b.type === "text" ? (b.text && b.text.length > 0) : true)
          .map((b) => {
            if (b.type === "text") {
              return { type: "text" as const, text: b.text };
            } else if (b.type === "tool_use") {
              return {
                type: "tool_use" as const,
                toolName: b.toolName,
                toolInput: b.toolInput,
              };
            } else {
              return {
                type: "tool_result" as const,
                toolOutput: b.toolOutput,
              };
            }
          });

        if (content.length > 0) {
          const msgs = new Map(get().messages);
          const existing = msgs.get(threadId) || [];
          // Get the pending cost info for this message
          const pendingCost = pendingMessageCosts.get(threadId);
          const finalMsg: Message = {
            id: crypto.randomUUID(),
            threadId,
            role: "assistant",
            content,
            costUsd: pendingCost?.costUsd ?? null,
            tokensIn: pendingCost?.tokensIn ?? null,
            tokensOut: pendingCost?.tokensOut ?? null,
            createdAt: new Date().toISOString(),
          };
          msgs.set(threadId, [...existing, finalMsg]);
          set({ messages: msgs });
        }
      }
      streaming.delete(threadId);
      // Clean up pending cost info
      pendingMessageCosts.delete(threadId);
      set({ streamingContent: streaming });
    }
  },

  handleStatusChange: (threadId: string, status: string) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId
          ? { ...t, status: status as ThreadInfo["status"] }
          : t
      ),
    }));

    // Do NOT delete streamingContent here. The backend sends agent:status
    // before agent:message(type:"status"). Deleting streaming blocks here
    // would race against handleStreamMessage which needs them to promote
    // blocks into finalized messages. Cleanup happens in handleStreamMessage.
  },

  handleError: (threadId: string, errorMessage: string) => {
    const errors = new Map(get().errors);
    errors.set(threadId, errorMessage);
    set({ errors });
  },
}));

// ── Global IPC listeners (registered once, always active) ──

let listenersInitialized = false;

export function initAgentListeners(): void {
  if (listenersInitialized) return;
  listenersInitialized = true;

  ipc.on("agent:message", (threadId: string, message: StreamMessage) => {
    useAgentStore.getState().handleStreamMessage(threadId, message);
  });

  ipc.on("agent:status", (threadId: string, status: string) => {
    useAgentStore.getState().handleStatusChange(threadId, status);
  });

  ipc.on("agent:error", (threadId: string, error: ErrorInfo) => {
    useAgentStore.getState().handleError(threadId, error.message);
  });
}
