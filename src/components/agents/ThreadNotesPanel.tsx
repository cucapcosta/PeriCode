import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNotesStore } from "@/stores/notesStore";

interface Props {
  threadId: string;
}

export const ThreadNotesPanel: React.FC<Props> = ({ threadId }) => {
  const { notes, loading, loadNote, saveNote } = useNotesStore();
  const [localContent, setLocalContent] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoading = loading.get(threadId) ?? false;
  const savedContent = notes.get(threadId);

  useEffect(() => {
    loadNote(threadId);
  }, [threadId, loadNote]);

  useEffect(() => {
    if (savedContent !== undefined) {
      setLocalContent(savedContent);
    }
  }, [savedContent]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setLocalContent(value);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveNote(threadId, value);
      }, 800);
    },
    [threadId, saveNote]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveNote(threadId, localContent);
  }, [threadId, localContent, saveNote]);

  if (isLoading && savedContent === undefined) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Carregando notas...
      </div>
    );
  }

  return (
    <div className="border-b border-border bg-muted/30">
      <textarea
        value={localContent}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Anotações privadas sobre esta thread... (o agente não vê)"
        rows={3}
        className="w-full resize-y bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none border-none"
      />
    </div>
  );
};
