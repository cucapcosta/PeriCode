import { create } from "zustand";
import { ipc } from "@/lib/ipc-client";
import type {
  ThreadInfo,
  Message,
  AgentLaunchConfig,
  StreamMessage,
} from "@/types/ipc";

interface AgentState {
  threads: ThreadInfo[];
  activeThreadId: string | null;
  messages: Map<string, Message[]>;
  streamingText: Map<string, string>;
  loading: boolean;

  loadThreads: (projectId: string) => Promise<void>;
  launchAgent: (config: AgentLaunchConfig) => Promise<ThreadInfo>;
  cancelAgent: (threadId: string) => Promise<void>;
  sendMessage: (threadId: string, message: string) => Promise<void>;
  setActiveThread: (threadId: string | null) => void;
  loadMessages: (threadId: string) => Promise<void>;

  handleStreamMessage: (threadId: string, message: StreamMessage) => void;
  handleStatusChange: (threadId: string, status: string) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  messages: new Map(),
  streamingText: new Map(),
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
    // Add the initial user message to local state
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

  sendMessage: async (threadId: string, message: string) => {
    // Add user message to local state immediately
    const userMsg: Message = {
      id: crypto.randomUUID(),
      threadId,
      role: "user",
      content: [{ type: "text", text: message }],
      costUsd: null,
      tokensIn: null,
      tokensOut: null,
      createdAt: new Date().toISOString(),
    };
    const msgs = new Map(get().messages);
    const existing = msgs.get(threadId) || [];
    msgs.set(threadId, [...existing, userMsg]);
    set({ messages: msgs });

    await ipc.invoke("agent:sendMessage", threadId, message);
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
      const streaming = new Map(get().streamingText);
      const current = streaming.get(threadId) || "";
      streaming.set(threadId, current + message.text);
      set({ streamingText: streaming });
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

    // When completed, flush streaming text to messages and reload
    if (status === "completed" || status === "failed") {
      const streaming = new Map(get().streamingText);
      streaming.delete(threadId);
      set({ streamingText: streaming });
      get().loadMessages(threadId);
    }
  },
}));
