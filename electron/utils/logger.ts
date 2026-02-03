type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, context: string, msg: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${msg}`;
}

export const logger = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  debug(context: string, msg: string, ...args: unknown[]): void {
    if (shouldLog("debug")) {
      console.debug(formatMessage("debug", context, msg), ...args);
    }
  },

  info(context: string, msg: string, ...args: unknown[]): void {
    if (shouldLog("info")) {
      console.info(formatMessage("info", context, msg), ...args);
    }
  },

  warn(context: string, msg: string, ...args: unknown[]): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", context, msg), ...args);
    }
  },

  error(context: string, msg: string, ...args: unknown[]): void {
    if (shouldLog("error")) {
      console.error(formatMessage("error", context, msg), ...args);
    }
  },
};
