import { ipcMain } from "electron";
import { storage } from "../services/storage";
import { detectCli } from "../utils/cli-detect";
import type { AppSettings } from "../../src/types/ipc";

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", (): AppSettings => {
    return storage.getAppSettings();
  });

  ipcMain.handle(
    "settings:update",
    (_event, settings: Partial<AppSettings>): void => {
      storage.updateAppSettings(settings);
    }
  );

  ipcMain.handle(
    "settings:getCliStatus",
    async (): Promise<{
      available: boolean;
      version: string | null;
      path: string | null;
    }> => {
      const settings = storage.getAppSettings();
      const customPath = settings.claudeCliPath ?? undefined;
      return detectCli(customPath);
    }
  );
}
