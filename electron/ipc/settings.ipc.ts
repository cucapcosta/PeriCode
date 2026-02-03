import { ipcMain } from "electron";
import type { AppSettings } from "../../src/types/ipc";

const defaultSettings: AppSettings = {
  theme: "dark",
  defaultModel: "sonnet",
  maxConcurrentAgents: 3,
  defaultBudgetLimitUsd: 10.0,
  fontSize: 14,
  interactionStyle: "detailed",
  diffViewMode: "unified",
  claudeCliPath: null,
  logLevel: "info",
};

let currentSettings: AppSettings = { ...defaultSettings };

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", (): AppSettings => {
    return { ...currentSettings };
  });

  ipcMain.handle(
    "settings:update",
    (_event, settings: Partial<AppSettings>): void => {
      currentSettings = { ...currentSettings, ...settings };
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
