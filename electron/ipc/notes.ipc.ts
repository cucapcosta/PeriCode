import { ipcMain } from "electron";
import { storage } from "../services/storage";

export function registerNotesHandlers(): void {
  ipcMain.handle(
    "notes:get",
    (_event, threadId: string): string | null => {
      return storage.getThreadNote(threadId);
    }
  );

  ipcMain.handle(
    "notes:save",
    (_event, threadId: string, content: string): void => {
      storage.saveThreadNote(threadId, content);
    }
  );

  ipcMain.handle(
    "notes:delete",
    (_event, threadId: string): void => {
      storage.deleteThreadNote(threadId);
    }
  );
}
