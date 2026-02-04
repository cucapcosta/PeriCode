import { BrowserWindow } from "electron";
import { spawnClaude } from "./claude-cli";
import { automationScheduler } from "./automation-scheduler";
import { storage } from "./storage";
import { skillsEngine } from "./skills-engine";
import { worktreeManager } from "./worktree-manager";
import { logger } from "../utils/logger";
import type {
  Automation,
  AutomationRun,
  AppNotification,
} from "../../src/types/ipc";

type SandboxPolicy = "read-only" | "workspace-write" | "full";

interface ExecutionContext {
  runId: string;
  automation: Automation;
  worktreePath: string | null;
  sandboxPolicy: SandboxPolicy;
  kill: (() => void) | null;
}

/**
 * Automation Executor handles running automation triggers as agent tasks.
 * Connects the scheduler to the agent orchestrator, manages worktrees,
 * captures results, and sends notifications.
 */
class AutomationExecutor {
  private activeRuns: Map<string, ExecutionContext> = new Map();

  /**
   * Initialize the executor by hooking into the scheduler's event system.
   */
  init(): void {
    automationScheduler.onEvent((type, automation, run) => {
      if (type === "triggered" && run) {
        this.executeRun(automation, run).catch((err) => {
          logger.error(
            "automation-executor",
            `Execution failed for ${automation.name}`,
            err
          );
        });
      }
    });

    logger.info("automation-executor", "Initialized");
  }

  /**
   * Execute an automation run.
   */
  async executeRun(
    automation: Automation,
    run: AutomationRun
  ): Promise<void> {
    const sandboxPolicy = (automation.triggerConfig.sandboxPolicy as SandboxPolicy) ?? "workspace-write";

    let worktreePath: string | null = null;

    try {
      // 1. Create a fresh git worktree (for git projects)
      const project = storage.getProject(automation.projectId);
      if (project) {
        try {
          const wt = await worktreeManager.create(
            project.path,
            `auto-${run.id.slice(0, 8)}`,
            `Automation: ${automation.name}`
          );
          worktreePath = wt.path;
          logger.info(
            "automation-executor",
            `Created worktree for run ${run.id}: ${wt.path}`
          );
        } catch (err) {
          logger.warn(
            "automation-executor",
            "Failed to create worktree, using project directory",
            err
          );
        }
      }

      const ctx: ExecutionContext = {
        runId: run.id,
        automation,
        worktreePath,
        sandboxPolicy,
        kill: null,
      };
      this.activeRuns.set(run.id, ctx);

      // 2. Load associated skills and build system prompt
      let systemPrompt = "";
      const allowedTools = this.getToolsForPolicy(sandboxPolicy);

      if (automation.skillIds.length > 0) {
        for (const skillId of automation.skillIds) {
          const skill = skillsEngine.resolve(skillId);
          if (skill) {
            const config = skillsEngine.invoke(skill);
            systemPrompt += config.systemPrompt + "\n\n";
            // Merge tools from skills (filtered by sandbox policy)
            for (const tool of config.tools) {
              if (
                !allowedTools.includes(tool) &&
                this.isToolAllowed(tool, sandboxPolicy)
              ) {
                allowedTools.push(tool);
              }
            }
          }
        }
      }

      // 3. Build the prompt
      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n---\n\n${automation.prompt}`
        : automation.prompt;

      // 4. Launch agent via CLI spawn
      const cwd = worktreePath ?? project?.path ?? process.cwd();

      let claudeCliPath: string | undefined;
      try {
        const settings = storage.getAppSettings();
        claudeCliPath = settings.claudeCliPath ?? undefined;
      } catch {
        // ignore
      }

      const { events, kill } = spawnClaude({
        prompt: fullPrompt,
        cwd,
        permissionMode:
          sandboxPolicy === "read-only" ? "plan" : "acceptEdits",
        allowedTools,
        claudePath: claudeCliPath,
      });

      ctx.kill = kill;

      const conversation: Array<{ role: string; content: string }> = [];
      let totalCostUsd = 0;

      for await (const message of events) {
        switch (message.type) {
          case "assistant": {
            const content = message.message?.content;
            if (Array.isArray(content)) {
              const text = content
                .filter(
                  (b: Record<string, unknown>) => b.type === "text"
                )
                .map((b: Record<string, unknown>) => b.text as string)
                .join("");
              if (text) {
                conversation.push({ role: "assistant", content: text });
              }
            }
            break;
          }
          case "result": {
            if (message.result) {
              conversation.push({ role: "assistant", content: message.result });
            }
            totalCostUsd = message.total_cost_usd ?? 0;
            break;
          }
        }
      }

      // 5. Store results in automation_runs table
      const result: Record<string, unknown> = {
        conversation,
        totalCostUsd,
        worktreePath,
        sandboxPolicy,
      };

      // Determine if there's actionable output
      const hasActionableOutput = conversation.length > 0 &&
        conversation.some((c) => c.content.length > 50);

      const finalStatus = hasActionableOutput ? "completed" : "completed";
      automationScheduler.completeRun(run.id, finalStatus, result);

      // 6. Notify user
      this.sendNotification(
        automation,
        run.id,
        "success",
        `Automation "${automation.name}" completed`
      );

      // 7. Auto-archive if no actionable output
      if (!hasActionableOutput) {
        storage.updateAutomationRun(run.id, { status: "archived" });
      }

      logger.info(
        "automation-executor",
        `Run ${run.id} completed for ${automation.name}`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown execution error";

      automationScheduler.completeRun(run.id, "failed", {
        error: message,
      });

      this.sendNotification(
        automation,
        run.id,
        "error",
        `Automation "${automation.name}" failed: ${message}`
      );

      logger.error(
        "automation-executor",
        `Run ${run.id} failed for ${automation.name}`,
        err
      );
    } finally {
      this.activeRuns.delete(run.id);
    }
  }

  /**
   * Get the list of running automation runs.
   */
  getActiveRuns(): ExecutionContext[] {
    return Array.from(this.activeRuns.values());
  }

  /**
   * Get the tools allowed based on the sandbox policy.
   */
  private getToolsForPolicy(policy: SandboxPolicy): string[] {
    switch (policy) {
      case "read-only":
        return ["Read", "Glob", "Grep"];
      case "workspace-write":
        return ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
      case "full":
        return [
          "Read",
          "Edit",
          "Write",
          "Bash",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
        ];
    }
  }

  /**
   * Check if a tool is allowed under the given sandbox policy.
   */
  private isToolAllowed(tool: string, policy: SandboxPolicy): boolean {
    const allowed = this.getToolsForPolicy(policy);
    return allowed.includes(tool);
  }

  /**
   * Send a notification to all renderer windows.
   */
  private sendNotification(
    automation: Automation,
    runId: string,
    type: "success" | "error",
    message: string
  ): void {
    const notification: AppNotification = {
      id: crypto.randomUUID(),
      type: type === "success" ? "success" : "error",
      title: automation.name,
      message,
      timestamp: new Date().toISOString(),
    };

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send("notification", notification);
    }
  }
}

export const automationExecutor = new AutomationExecutor();
