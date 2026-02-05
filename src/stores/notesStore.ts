import { create } from "zustand";
import { ipc } from "@/lib/ipc-client";

interface NotesState {
  notes: Map<string, string>;
  loading: Map<string, boolean>;

  loadNote: (threadId: string) => Promise<void>;
  saveNote: (threadId: string, content: string) => Promise<void>;
  deleteNote: (threadId: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: new Map(),
  loading: new Map(),

  loadNote: async (threadId: string) => {
    const loading = new Map(get().loading);
    loading.set(threadId, true);
    set({ loading });

    try {
      const content = await ipc.invoke("notes:get", threadId);
      const notes = new Map(get().notes);
      notes.set(threadId, content ?? "");
      set({ notes });
    } finally {
      const loading = new Map(get().loading);
      loading.set(threadId, false);
      set({ loading });
    }
  },

  saveNote: async (threadId: string, content: string) => {
    const notes = new Map(get().notes);
    notes.set(threadId, content);
    set({ notes });
    await ipc.invoke("notes:save", threadId, content);
  },

  deleteNote: async (threadId: string) => {
    await ipc.invoke("notes:delete", threadId);
    const notes = new Map(get().notes);
    notes.delete(threadId);
    set({ notes });
  },
}));
