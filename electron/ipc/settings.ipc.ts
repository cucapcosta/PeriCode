import { ipcMain } from "electron";
import { storage } from "../services/storage";
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
    "settings:getApiKeyStatus",
    (): { valid: boolean; provider: string } => {
      const hasKey = !!process.env.ANTHROPIC_API_KEY;
      return { valid: hasKey, provider: "anthropic" };
    }
  );
}
