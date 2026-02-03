import { ipcMain } from "electron";
import type { AgentLaunchConfig, ThreadInfo } from "../../src/types/ipc";

// Placeholder implementations - will be connected to agent-orchestrator in Phase 1.4
const runningAgents: Map<string, ThreadInfo> = new Map();

export function registerAgentHandlers(): void {
  ipcMain.handle(
    "agent:launch",
    (_event, config: AgentLaunchConfig): ThreadInfo => {
      const id = crypto.randomUUID();
      const thread: ThreadInfo = {
        id,
        projectId: config.projectId,
        title: config.prompt.slice(0, 100),
        status: "running",
        sessionId: null,
        worktreePath: null,
        worktreeBranch: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      runningAgents.set(id, thread);
      return thread;
    }
  );

  ipcMain.handle("agent:pause", (_event, threadId: string): void => {
    const agent = runningAgents.get(threadId);
    if (agent) {
      agent.status = "paused";
      agent.updatedAt = new Date().toISOString();
    }
  });

  ipcMain.handle("agent:resume", (_event, threadId: string): void => {
    const agent = runningAgents.get(threadId);
    if (agent) {
      agent.status = "running";
      agent.updatedAt = new Date().toISOString();
    }
  });

  ipcMain.handle("agent:cancel", (_event, threadId: string): void => {
    const agent = runningAgents.get(threadId);
    if (agent) {
      agent.status = "failed";
      agent.updatedAt = new Date().toISOString();
    }
  });

  ipcMain.handle(
    "agent:sendMessage",
    (_event, _threadId: string, _message: string): void => {
      // Will be implemented in Phase 1.4
    }
  );

  ipcMain.handle("agent:getRunning", (): ThreadInfo[] => {
    return Array.from(runningAgents.values()).filter(
      (a) => a.status === "running"
    );
  });
}
