import React, { useState, useEffect, useCallback } from "react";
import { ipc } from "@/lib/ipc-client";
import type { AppNotification } from "@/types/ipc";

interface ToastItem extends AppNotification {
  exiting?: boolean;
}

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((notification: AppNotification) => {
    setToasts((prev) => [...prev.slice(-4), notification]);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === notification.id ? { ...t, exiting: true } : t))
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== notification.id));
      }, 300);
    }, 5000);
  }, []);

  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const notification = args[0] as AppNotification;
      if (notification && notification.id) {
        addToast(notification);
      }
    };
    ipc.on("notification", handler);
    return () => {
      ipc.off("notification");
    };
  }, [addToast]);

  const dismiss = (id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  };

  const typeStyles: Record<AppNotification["type"], string> = {
    info: "border-blue-500/30 bg-blue-500/10",
    success: "border-green-500/30 bg-green-500/10",
    warning: "border-yellow-500/30 bg-yellow-500/10",
    error: "border-red-500/30 bg-red-500/10",
  };

  const typeIcons: Record<AppNotification["type"], string> = {
    info: "i",
    success: "+",
    warning: "!",
    error: "x",
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-40 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`border rounded-lg px-4 py-3 shadow-lg transition-all duration-300 ${
            typeStyles[toast.type]
          } ${
            toast.exiting
              ? "opacity-0 translate-x-4"
              : "opacity-100 translate-x-0"
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="text-xs font-mono font-bold mt-0.5">
              {typeIcons[toast.type]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{toast.title}</p>
              <p className="text-xs text-muted-foreground truncate">{toast.message}</p>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-muted-foreground hover:text-foreground text-xs shrink-0"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
