import { ipcMain } from "electron";
import { agentOrchestrator } from "../services/agent-orchestrator";
import { storage } from "../services/storage";
import type { AgentLaunchConfig, ThreadInfo, ThreadDetail, Message } from "../../src/types/ipc";

export function registerAgentHandlers(): void {
  ipcMain.handle(
    "agent:launch",
    async (_event, config: AgentLaunchConfig): Promise<ThreadInfo> => {
      return agentOrchestrator.launch(config);
    }
  );

  ipcMain.handle("agent:pause", (_event, threadId: string): void => {
    storage.updateThreadStatus(threadId, "paused");
  });

  ipcMain.handle("agent:resume", (_event, threadId: string): void => {
    storage.updateThreadStatus(threadId, "running");
  });

  ipcMain.handle("agent:cancel", async (_event, threadId: string): Promise<void> => {
    await agentOrchestrator.cancel(threadId);
  });

  ipcMain.handle(
    "agent:sendMessage",
    async (_event, threadId: string, message: string): Promise<void> => {
      await agentOrchestrator.sendMessage(threadId, message);
    }
  );

  ipcMain.handle("agent:getRunning", (): ThreadInfo[] => {
    const runningIds = agentOrchestrator.getRunningThreadIds();
    return runningIds
      .map((id) => storage.getThread(id))
      .filter((t): t is ThreadInfo => t !== null);
  });

  // Thread handlers
  ipcMain.handle("thread:list", (_event, projectId: string): ThreadInfo[] => {
    return storage.listThreads(projectId);
  });

  ipcMain.handle("thread:get", (_event, threadId: string): ThreadDetail => {
    const thread = storage.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const messages = storage.listMessages(threadId);
    return { ...thread, messages };
  });

  ipcMain.handle("thread:getMessages", (_event, threadId: string): Message[] => {
    return storage.listMessages(threadId);
  });

  ipcMain.handle("thread:delete", (_event, threadId: string): void => {
    if (agentOrchestrator.isRunning(threadId)) {
      agentOrchestrator.cancel(threadId);
    }
    storage.deleteThread(threadId);
  });

  ipcMain.handle("thread:fork", (_event, _threadId: string): ThreadInfo => {
    // Fork will be fully implemented in Phase 2 with worktrees
    throw new Error("Thread forking not yet implemented");
  });
}
