import { ipcMain } from "electron";
import { agentOrchestrator } from "../services/agent-orchestrator";
import { automationScheduler } from "../services/automation-scheduler";
import { notificationService } from "../services/notification-service";
import { storage } from "../services/storage";
import { detectCli } from "../utils/cli-detect";
import type { StatusInfo, AppNotification } from "../../src/types/ipc";

export function registerStatusHandlers(): void {
  ipcMain.handle("status:getInfo", async (): Promise<StatusInfo> => {
    // Agent stats
    const runningAgents = agentOrchestrator.getRunningAgents();
    const queuedAgents = agentOrchestrator.getQueuedCount();
    const totalCostUsd = agentOrchestrator.getTotalCost();

    // Aggregate tokens from running agents
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    for (const agent of runningAgents) {
      totalTokensIn += agent.tokensIn;
      totalTokensOut += agent.tokensOut;
    }

    // Per-model usage (global accumulator includes all agents, past and present)
    const modelUsage = agentOrchestrator.getGlobalModelUsage();

    // CLI status
    let customPath: string | undefined;
    try {
      const settings = storage.getAppSettings();
      customPath = settings.claudeCliPath ?? undefined;
    } catch {
      // ignore
    }
    const cli = await detectCli(customPath);

    // Automation stats
    const scheduled = automationScheduler.getScheduled();
    const activeAutomations = scheduled.filter((s) => s.active).length;

    // Find next cron run (approximate - check enabled cron automations)
    let nextAutomationRun: string | null = null;
    for (const task of scheduled) {
      if (!task.active) continue;
      const automation = storage.getAutomation(task.automationId);
      if (automation && automation.triggerType === "cron" && automation.schedule) {
        nextAutomationRun = automation.schedule;
        break;
      }
    }

    return {
      runningAgents: runningAgents.length,
      queuedAgents,
      totalCostUsd,
      totalTokensIn,
      totalTokensOut,
      modelUsage,
      cliAvailable: cli.available,
      cliVersion: cli.version,
      activeAutomations,
      nextAutomationRun,
    };
  });

  ipcMain.handle("notification:getHistory", (): AppNotification[] => {
    return notificationService.getHistory();
  });

  ipcMain.handle("notification:clear", (): void => {
    notificationService.clearHistory();
  });
}
