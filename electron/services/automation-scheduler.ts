import cron, { type ScheduledTask as CronTask } from "node-cron";
import chokidar, { type FSWatcher } from "chokidar";
import { storage } from "./storage";
import { logger } from "../utils/logger";
import type {
  Automation,
  AutomationRun,
  AutomationConfig,
} from "../../src/types/ipc";

interface ScheduledTask {
  automationId: string;
  cronTask?: CronTask;
  watcher?: FSWatcher;
}

type AutomationEventType =
  | "triggered"
  | "completed"
  | "failed"
  | "registered"
  | "unregistered"
  | "paused"
  | "resumed";

type AutomationEventHandler = (
  type: AutomationEventType,
  automation: Automation,
  run?: AutomationRun
) => void;

class AutomationScheduler {
  private scheduled: Map<string, ScheduledTask> = new Map();
  private eventHandlers: Set<AutomationEventHandler> = new Set();

  /**
   * Register an automation for scheduled or event-based execution.
   */
  register(automation: Automation): void {
    // Clean up existing if re-registering
    this.cleanupTask(automation.id);

    const task: ScheduledTask = { automationId: automation.id };

    if (!automation.enabled) {
      this.scheduled.set(automation.id, task);
      return;
    }

    switch (automation.triggerType) {
      case "cron":
        if (automation.schedule && cron.validate(automation.schedule)) {
          task.cronTask = cron.schedule(automation.schedule, () => {
            this.trigger(automation.id).catch((err) => {
              logger.error("automation-scheduler", `Cron trigger failed for ${automation.id}`, err);
            });
          });
          logger.info("automation-scheduler", `Registered cron: ${automation.name} (${automation.schedule})`);
        }
        break;

      case "file_change": {
        const watchPaths = automation.triggerConfig.paths as string[] | undefined;
        if (watchPaths && watchPaths.length > 0) {
          task.watcher = chokidar.watch(watchPaths, {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 500 },
          });
          task.watcher.on("change", () => {
            this.trigger(automation.id).catch((err) => {
              logger.error("automation-scheduler", `File change trigger failed for ${automation.id}`, err);
            });
          });
          logger.info("automation-scheduler", `Registered file watcher: ${automation.name}`);
        }
        break;
      }

      case "git_event":
        // Git event triggers are checked via polling or hook integration
        // For now, register but actual git monitoring is handled separately
        logger.info("automation-scheduler", `Registered git event: ${automation.name}`);
        break;

      case "manual":
        logger.info("automation-scheduler", `Registered manual: ${automation.name}`);
        break;
    }

    this.scheduled.set(automation.id, task);
    this.emitEvent("registered", automation);
  }

  /**
   * Unregister an automation and clean up any scheduled tasks.
   */
  unregister(automationId: string): void {
    const automation = storage.getAutomation(automationId);
    this.cleanupTask(automationId);
    this.scheduled.delete(automationId);
    if (automation) {
      this.emitEvent("unregistered", automation);
    }
  }

  /**
   * Trigger an automation manually or from a scheduled event.
   * Returns the new automation run record.
   */
  async trigger(automationId: string): Promise<AutomationRun> {
    const automation = storage.getAutomation(automationId);
    if (!automation) {
      throw new Error(`Automation not found: ${automationId}`);
    }

    if (!automation.enabled) {
      throw new Error(`Automation is disabled: ${automation.name}`);
    }

    const runId = crypto.randomUUID();
    const run = storage.addAutomationRun(runId, automationId);

    // Update last_run_at
    storage.updateAutomation(automationId, {
      lastRunAt: new Date().toISOString(),
    });

    logger.info("automation-scheduler", `Triggered automation: ${automation.name} (run: ${runId})`);
    this.emitEvent("triggered", automation, run);

    return run;
  }

  /**
   * Get all scheduled tasks.
   */
  getScheduled(): Array<{ automationId: string; active: boolean }> {
    const result: Array<{ automationId: string; active: boolean }> = [];
    for (const [id, task] of this.scheduled) {
      const active = !!(task.cronTask || task.watcher);
      result.push({ automationId: id, active });
    }
    return result;
  }

  /**
   * Get run history for an automation.
   */
  getHistory(automationId: string): AutomationRun[] {
    return storage.listAutomationRuns(automationId);
  }

  /**
   * Pause an automation (disable without unregistering).
   */
  pause(automationId: string): void {
    const automation = storage.getAutomation(automationId);
    if (!automation) return;

    const task = this.scheduled.get(automationId);
    if (task?.cronTask) {
      task.cronTask.stop();
    }
    if (task?.watcher) {
      task.watcher.close();
      task.watcher = undefined;
    }

    storage.updateAutomation(automationId, { enabled: false });
    this.emitEvent("paused", automation);
  }

  /**
   * Resume a paused automation.
   */
  resume(automationId: string): void {
    const automation = storage.getAutomation(automationId);
    if (!automation) return;

    storage.updateAutomation(automationId, { enabled: true });
    const updated = storage.getAutomation(automationId)!;
    this.register(updated);
    this.emitEvent("resumed", updated);
  }

  /**
   * Create a new automation from config and register it.
   */
  create(config: AutomationConfig): Automation {
    const id = crypto.randomUUID();
    const automation = storage.addAutomation(
      id,
      config.projectId,
      config.name,
      config.prompt,
      config.triggerType,
      config.triggerConfig ?? {},
      config.skillIds ?? [],
      config.schedule ?? null,
      true
    );

    this.register(automation);
    return automation;
  }

  /**
   * Update an existing automation.
   */
  update(id: string, config: Partial<AutomationConfig>): Automation {
    const updates: Parameters<typeof storage.updateAutomation>[1] = {};
    if (config.name !== undefined) updates.name = config.name;
    if (config.prompt !== undefined) updates.prompt = config.prompt;
    if (config.skillIds !== undefined) updates.skillIds = config.skillIds;
    if (config.schedule !== undefined) updates.schedule = config.schedule;
    if (config.triggerType !== undefined) updates.triggerType = config.triggerType;
    if (config.triggerConfig !== undefined) updates.triggerConfig = config.triggerConfig;

    const automation = storage.updateAutomation(id, updates);

    // Re-register to update triggers
    this.register(automation);
    return automation;
  }

  /**
   * Delete an automation.
   */
  delete(id: string): void {
    this.unregister(id);
    storage.deleteAutomation(id);
  }

  /**
   * Toggle enabled/disabled.
   */
  toggleEnabled(id: string): void {
    const automation = storage.getAutomation(id);
    if (!automation) return;

    if (automation.enabled) {
      this.pause(id);
    } else {
      this.resume(id);
    }
  }

  /**
   * Complete an automation run with results.
   */
  completeRun(
    runId: string,
    status: "completed" | "failed",
    result?: Record<string, unknown>
  ): AutomationRun {
    const run = storage.updateAutomationRun(runId, {
      status,
      result,
      finishedAt: new Date().toISOString(),
    });

    const automation = storage.getAutomation(run.automationId);
    if (automation) {
      this.emitEvent(status === "completed" ? "completed" : "failed", automation, run);
    }

    return run;
  }

  /**
   * Load all automations for a project and register them.
   */
  loadProjectAutomations(projectId: string): void {
    const automations = storage.listAutomations(projectId);
    for (const automation of automations) {
      this.register(automation);
    }
  }

  /**
   * Subscribe to automation events.
   */
  onEvent(handler: AutomationEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Unsubscribe from automation events.
   */
  offEvent(handler: AutomationEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Clean up all scheduled tasks.
   */
  shutdown(): void {
    for (const [id] of this.scheduled) {
      this.cleanupTask(id);
    }
    this.scheduled.clear();
  }

  private cleanupTask(automationId: string): void {
    const task = this.scheduled.get(automationId);
    if (!task) return;

    if (task.cronTask) {
      task.cronTask.stop();
    }
    if (task.watcher) {
      task.watcher.close();
    }
  }

  private emitEvent(
    type: AutomationEventType,
    automation: Automation,
    run?: AutomationRun
  ): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(type, automation, run);
      } catch (err) {
        logger.error("automation-scheduler", "Event handler error", err);
      }
    }
  }
}

export const automationScheduler = new AutomationScheduler();
