import { ipcMain, BrowserWindow } from "electron";
import { automationScheduler } from "../services/automation-scheduler";
import { storage } from "../services/storage";
import type {
  Automation,
  AutomationConfig,
  AutomationRun,
  InboxFilters,
} from "../../src/types/ipc";

export function registerAutomationHandlers(): void {
  ipcMain.handle(
    "automation:list",
    async (_event, projectId: string): Promise<Automation[]> => {
      return storage.listAutomations(projectId);
    }
  );

  ipcMain.handle(
    "automation:create",
    async (_event, config: AutomationConfig): Promise<Automation> => {
      return automationScheduler.create(config);
    }
  );

  ipcMain.handle(
    "automation:update",
    async (
      _event,
      id: string,
      config: Partial<AutomationConfig>
    ): Promise<Automation> => {
      return automationScheduler.update(id, config);
    }
  );

  ipcMain.handle(
    "automation:delete",
    async (_event, id: string): Promise<void> => {
      automationScheduler.delete(id);
    }
  );

  ipcMain.handle(
    "automation:trigger",
    async (_event, id: string): Promise<AutomationRun> => {
      return automationScheduler.trigger(id);
    }
  );

  ipcMain.handle(
    "automation:toggleEnabled",
    async (_event, id: string): Promise<void> => {
      automationScheduler.toggleEnabled(id);
    }
  );

  ipcMain.handle(
    "automation:getHistory",
    async (_event, id: string): Promise<AutomationRun[]> => {
      return automationScheduler.getHistory(id);
    }
  );

  ipcMain.handle(
    "automation:getInbox",
    async (_event, filters?: InboxFilters): Promise<AutomationRun[]> => {
      return storage.listInboxRuns(filters);
    }
  );

  ipcMain.handle(
    "automation:markRead",
    async (_event, runId: string): Promise<void> => {
      storage.updateAutomationRun(runId, { read: true });
    }
  );

  ipcMain.handle(
    "automation:archiveRun",
    async (_event, runId: string): Promise<void> => {
      storage.updateAutomationRun(runId, { status: "archived" });
    }
  );

  // Forward automation completion events to renderer
  automationScheduler.onEvent((type, automation, run) => {
    if (type === "completed" || type === "failed") {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (run) {
          win.webContents.send("automation:completed", run);
        }
      }
    }
  });
}
