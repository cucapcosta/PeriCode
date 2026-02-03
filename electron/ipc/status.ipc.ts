import { ipcMain } from "electron";
import { agentOrchestrator } from "../services/agent-orchestrator";
import { automationScheduler } from "../services/automation-scheduler";
import { notificationService } from "../services/notification-service";
import { storage } from "../services/storage";
import type { StatusInfo, AppNotification } from "../../src/types/ipc";

export function registerStatusHandlers(): void {
  ipcMain.handle("status:getInfo", (): StatusInfo => {
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

    // API key status
    const hasKey = !!process.env.ANTHROPIC_API_KEY;

    // Automation stats
    const scheduled = automationScheduler.getScheduled();
    const activeAutomations = scheduled.filter((s) => s.active).length;

    // Find next cron run (approximate - check enabled cron automations)
    let nextAutomationRun: string | null = null;
    for (const task of scheduled) {
      if (!task.active) continue;
      const automation = storage.getAutomation(task.automationId);
      if (automation && automation.triggerType === "cron" && automation.schedule) {
        // For cron automations, estimate next run as "has cron schedule"
        // Full next-run calculation would require cron-parser; use schedule string
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
      apiKeyValid: hasKey,
      apiKeyProvider: "anthropic",
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
