import { dialog, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { worktreeManager } from "./worktree-manager";
import { agentOrchestrator } from "./agent-orchestrator";
import { logger } from "../utils/logger";
import type { Message, MessageContent } from "../../src/types/ipc";

/**
 * Format a message for markdown export.
 */
function messageToMarkdown(msg: Message): string {
  const roleLabel =
    msg.role === "user" ? "User" :
    msg.role === "assistant" ? "Assistant" :
    msg.role === "system" ? "System" :
    msg.role === "tool_use" ? "Tool Use" : "Tool Result";

  const time = new Date(msg.createdAt).toLocaleString();
  let body = "";

  for (const block of msg.content) {
    if (block.type === "text" && block.text) {
      body += block.text + "\n";
    } else if (block.type === "tool_use") {
      body += `\`${block.toolName}\``;
      if (block.toolInput) {
        body += "\n```json\n" + JSON.stringify(block.toolInput, null, 2) + "\n```\n";
      }
    } else if (block.type === "tool_result" && block.toolOutput) {
      body += "```\n" + block.toolOutput + "\n```\n";
    }
  }

  const costLine = msg.costUsd != null ? ` | Cost: $${msg.costUsd.toFixed(4)}` : "";
  const tokenLine =
    msg.tokensIn != null || msg.tokensOut != null
      ? ` | Tokens: ${msg.tokensIn ?? 0} in / ${msg.tokensOut ?? 0} out`
      : "";

  return `### ${roleLabel} (${time}${costLine}${tokenLine})\n\n${body}\n---\n`;
}

export const exportService = {
  /**
   * Export a thread conversation as Markdown.
   * Returns the file path where it was saved.
   */
  async exportThreadAsMarkdown(threadId: string): Promise<string | null> {
    const thread = storage.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const messages = storage.listMessages(threadId);
    const project = storage.getProject(thread.projectId);

    let markdown = `# Thread: ${thread.title ?? "Untitled"}\n\n`;
    markdown += `- **Project**: ${project?.name ?? "Unknown"}\n`;
    markdown += `- **Status**: ${thread.status}\n`;
    markdown += `- **Created**: ${new Date(thread.createdAt).toLocaleString()}\n`;
    if (thread.worktreeBranch) {
      markdown += `- **Branch**: ${thread.worktreeBranch}\n`;
    }
    markdown += `\n---\n\n`;

    for (const msg of messages) {
      markdown += messageToMarkdown(msg);
      markdown += "\n";
    }

    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      defaultPath: `thread-${thread.title?.slice(0, 30)?.replace(/[^a-zA-Z0-9]/g, "-") ?? threadId}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (result.canceled || !result.filePath) return null;

    fs.writeFileSync(result.filePath, markdown, "utf-8");
    logger.info("export-service", `Exported thread to ${result.filePath}`);
    return result.filePath;
  },

  /**
   * Export diff from a thread's worktree as a patch file.
   */
  async exportDiffAsPatch(threadId: string): Promise<string | null> {
    const thread = storage.getThread(threadId);
    if (!thread?.worktreePath) throw new Error("Thread has no worktree");

    const diffs = await worktreeManager.getDiff(thread.worktreePath);

    let patch = "";
    for (const diff of diffs) {
      patch += `--- a/${diff.path}\n`;
      patch += `+++ b/${diff.path}\n`;
      patch += `@@ Status: ${diff.status} (+${diff.additions}/-${diff.deletions}) @@\n`;
      if (diff.oldContent != null && diff.newContent != null) {
        // Simple unified diff representation
        const oldLines = diff.oldContent.split("\n");
        const newLines = diff.newContent.split("\n");
        for (const line of oldLines) {
          patch += `-${line}\n`;
        }
        for (const line of newLines) {
          patch += `+${line}\n`;
        }
      }
      patch += "\n";
    }

    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      defaultPath: `diff-${threadId.slice(0, 8)}.patch`,
      filters: [{ name: "Patch", extensions: ["patch", "diff"] }],
    });

    if (result.canceled || !result.filePath) return null;

    fs.writeFileSync(result.filePath, patch, "utf-8");
    logger.info("export-service", `Exported diff to ${result.filePath}`);
    return result.filePath;
  },

  /**
   * Export automation run history as CSV.
   */
  async exportAutomationHistoryAsCsv(projectId: string): Promise<string | null> {
    const automations = storage.listAutomations(projectId);
    const rows: string[] = [
      "automation_id,automation_name,run_id,status,started_at,finished_at",
    ];

    for (const auto of automations) {
      const runs = storage.listAutomationRuns(auto.id);
      for (const run of runs) {
        rows.push(
          [
            auto.id,
            `"${auto.name.replace(/"/g, '""')}"`,
            run.id,
            run.status,
            run.startedAt,
            run.finishedAt ?? "",
          ].join(",")
        );
      }
    }

    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      defaultPath: `automation-history.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });

    if (result.canceled || !result.filePath) return null;

    fs.writeFileSync(result.filePath, rows.join("\n"), "utf-8");
    logger.info("export-service", `Exported automation history to ${result.filePath}`);
    return result.filePath;
  },

  /**
   * Generate a project cost report.
   */
  async exportCostReport(projectId: string): Promise<string | null> {
    const project = storage.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const threads = storage.listThreads(projectId);

    let markdown = `# Cost Report: ${project.name}\n\n`;
    markdown += `- **Generated**: ${new Date().toLocaleString()}\n`;
    markdown += `- **Total Session Cost**: $${agentOrchestrator.getTotalCost().toFixed(4)}\n`;
    markdown += `- **Project Cost**: $${agentOrchestrator.getProjectCost(projectId).toFixed(4)}\n\n`;

    markdown += `## Thread Breakdown\n\n`;
    markdown += `| Thread | Status | Cost (USD) | Tokens In | Tokens Out |\n`;
    markdown += `|--------|--------|-----------|-----------|------------|\n`;

    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;

    for (const thread of threads) {
      const messages = storage.listMessages(thread.id);
      let threadCost = 0;
      let threadIn = 0;
      let threadOut = 0;

      for (const msg of messages) {
        if (msg.costUsd != null) threadCost += msg.costUsd;
        if (msg.tokensIn != null) threadIn += msg.tokensIn;
        if (msg.tokensOut != null) threadOut += msg.tokensOut;
      }

      totalCost += threadCost;
      totalIn += threadIn;
      totalOut += threadOut;

      const title = (thread.title ?? "Untitled").slice(0, 40);
      markdown += `| ${title} | ${thread.status} | $${threadCost.toFixed(4)} | ${threadIn} | ${threadOut} |\n`;
    }

    markdown += `| **Total** | | **$${totalCost.toFixed(4)}** | **${totalIn}** | **${totalOut}** |\n`;

    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? BrowserWindow.getAllWindows()[0], {
      defaultPath: `cost-report-${project.name.replace(/[^a-zA-Z0-9]/g, "-")}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (result.canceled || !result.filePath) return null;

    fs.writeFileSync(result.filePath, markdown, "utf-8");
    logger.info("export-service", `Exported cost report to ${result.filePath}`);
    return result.filePath;
  },
};
