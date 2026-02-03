import { app, BrowserWindow } from "electron";
import path from "path";
import { registerAllIPCHandlers } from "./ipc";
import { storage } from "./services/storage";
import { getDatabasePath } from "./utils/paths";
import { logger } from "./utils/logger";
import { agentOrchestrator } from "./services/agent-orchestrator";
import { notificationService } from "./services/notification-service";
import { terminalService } from "./services/terminal-service";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "PeriCode",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Show window when ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await storage.initialize(getDatabasePath());
    logger.info("main", "Database initialized");
  } catch (err) {
    logger.error("main", "Failed to initialize database", err);
  }

  registerAllIPCHandlers();
  createWindow();

  if (mainWindow) {
    agentOrchestrator.setMainWindow(mainWindow);
  }

  // Wire up agent event notifications
  agentOrchestrator.onEvent("completed", (event) => {
    const thread = storage.getThread(event.threadId);
    const title = thread?.title?.slice(0, 60) ?? "Agent";
    notificationService.notify(
      "success",
      "Agent Completed",
      `${title} finished ($${(event.costUsd ?? 0).toFixed(4)})`
    );
  });

  agentOrchestrator.onEvent("failed", (event) => {
    const thread = storage.getThread(event.threadId);
    const title = thread?.title?.slice(0, 60) ?? "Agent";
    notificationService.notify("error", "Agent Failed", `${title} encountered an error`);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  terminalService.shutdown();
  storage.close();
});
