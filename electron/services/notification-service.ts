import { Notification, BrowserWindow } from "electron";
import { logger } from "../utils/logger";
import type { AppNotification } from "../../src/types/ipc";

class NotificationService {
  private history: AppNotification[] = [];
  private maxHistory = 100;

  /**
   * Send a notification both as a native OS notification and to the renderer.
   */
  notify(
    type: AppNotification["type"],
    title: string,
    message: string
  ): AppNotification {
    const notification: AppNotification = {
      id: crypto.randomUUID(),
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
    };

    this.history.unshift(notification);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }

    // Send native OS notification
    if (Notification.isSupported()) {
      try {
        const native = new Notification({
          title,
          body: message,
          silent: type === "info",
        });
        native.show();
      } catch (err) {
        logger.warn("notification-service", "Failed to show native notification", err);
      }
    }

    // Forward to renderer
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("notification", notification);
      }
    }

    return notification;
  }

  getHistory(): AppNotification[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

export const notificationService = new NotificationService();
