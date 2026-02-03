import { ipcMain, shell } from "electron";
import { storage } from "../services/storage";
import { worktreeManager } from "../services/worktree-manager";
import type { FileDiff, WorktreeInfo, GitStatus } from "../../src/types/ipc";

export function registerWorktreeHandlers(): void {
  ipcMain.handle(
    "worktree:getDiff",
    async (_event, threadId: string): Promise<FileDiff[]> => {
      const thread = storage.getThread(threadId);
      if (!thread || !thread.worktreePath) {
        return [];
      }
      return worktreeManager.getDiff(thread.worktreePath);
    }
  );

  ipcMain.handle(
    "worktree:acceptAll",
    async (_event, threadId: string): Promise<void> => {
      const thread = storage.getThread(threadId);
      if (!thread || !thread.worktreePath) {
        throw new Error("Thread has no worktree");
      }
      const project = storage.getProject(thread.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      // Get the default branch to merge into
      const worktrees = await worktreeManager.list(project.path);
      const mainWorktree = worktrees.find((w) => w.isMain);
      const targetBranch = mainWorktree?.branch ?? "main";

      await worktreeManager.syncBack(
        project.path,
        thread.worktreePath,
        targetBranch
      );
    }
  );

  ipcMain.handle(
    "worktree:acceptFile",
    async (
      _event,
      threadId: string,
      _filePath: string
    ): Promise<void> => {
      const thread = storage.getThread(threadId);
      if (!thread || !thread.worktreePath) {
        throw new Error("Thread has no worktree");
      }
      // Per-file cherry-pick will be implemented in Phase 2.4 (Diff Review Workflow)
      // For now, throw a not-implemented error
      throw new Error("Per-file accept not yet implemented. Use Accept All.");
    }
  );

  ipcMain.handle(
    "worktree:reject",
    async (_event, threadId: string): Promise<void> => {
      const thread = storage.getThread(threadId);
      if (!thread || !thread.worktreePath) {
        throw new Error("Thread has no worktree");
      }
      const project = storage.getProject(thread.projectId);
      if (!project) {
        throw new Error("Project not found");
      }
      // Destroy the worktree and its branch, discarding all changes
      await worktreeManager.destroy(project.path, thread.worktreePath);
      // Clear worktree reference from thread
      storage.updateThreadWorktree(threadId, null, null);
    }
  );

  ipcMain.handle(
    "worktree:openInEditor",
    async (
      _event,
      threadId: string,
      filePath: string
    ): Promise<void> => {
      const thread = storage.getThread(threadId);
      if (!thread || !thread.worktreePath) {
        throw new Error("Thread has no worktree");
      }
      const fullPath = require("path").join(thread.worktreePath, filePath);
      await shell.openPath(fullPath);
    }
  );
}
