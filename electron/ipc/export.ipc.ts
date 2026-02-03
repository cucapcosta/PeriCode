import { ipcMain } from "electron";
import { exportService } from "../services/export-service";

export function registerExportHandlers(): void {
  ipcMain.handle(
    "export:threadMarkdown",
    async (_event, threadId: string): Promise<string | null> => {
      return exportService.exportThreadAsMarkdown(threadId);
    }
  );

  ipcMain.handle(
    "export:diffPatch",
    async (_event, threadId: string): Promise<string | null> => {
      return exportService.exportDiffAsPatch(threadId);
    }
  );

  ipcMain.handle(
    "export:automationCsv",
    async (_event, projectId: string): Promise<string | null> => {
      return exportService.exportAutomationHistoryAsCsv(projectId);
    }
  );

  ipcMain.handle(
    "export:costReport",
    async (_event, projectId: string): Promise<string | null> => {
      return exportService.exportCostReport(projectId);
    }
  );
}
