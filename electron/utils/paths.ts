import path from "path";
import { app } from "electron";

/**
 * Platform-specific path resolution for PeriCode data directories.
 */
export function getAppDataPath(): string {
  return path.join(app.getPath("userData"));
}

export function getDatabasePath(): string {
  return path.join(getAppDataPath(), "pericode.db");
}

export function getSkillsPath(): string {
  return path.join(getAppDataPath(), "skills");
}

export function getLogsPath(): string {
  return path.join(getAppDataPath(), "logs");
}

export function getWorktreeBasePath(projectPath: string): string {
  return path.join(projectPath, ".pericode-worktrees");
}
