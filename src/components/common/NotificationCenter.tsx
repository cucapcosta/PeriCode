import React, { useState, useEffect } from "react";
import { ipc } from "@/lib/ipc-client";
import type { AppNotification } from "@/types/ipc";

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  open,
  onClose,
}) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open]);

  const loadHistory = async () => {
    try {
      const history = await ipc.invoke("notification:getHistory");
      if (Array.isArray(history)) {
        setNotifications(history);
      }
    } catch {
      // Non-critical
    }
  };

  const clearAll = async () => {
    try {
      await ipc.invoke("notification:clear");
      setNotifications([]);
    } catch {
      // Non-critical
    }
  };

  const typeColors: Record<AppNotification["type"], string> = {
    info: "text-blue-400",
    success: "text-green-400",
    warning: "text-yellow-400",
    error: "text-red-400",
  };

  const formatTime = (timestamp: string): string => {
    const d = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end pt-12 pr-2 sm:pr-4">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[calc(100%-1rem)] sm:w-80 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              x
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className="px-4 py-3 border-b border-border last:border-0 hover:bg-accent/30"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs font-bold ${typeColors[n.type]}`}>
                    {n.type.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTime(n.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground truncate">{n.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
