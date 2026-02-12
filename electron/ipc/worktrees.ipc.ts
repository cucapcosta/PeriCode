import { ipcMain, shell, app } from "electron";
import simpleGit from "simple-git";
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
      const path = require("path");
      const { execFile } = require("child_process");
      const thread = storage.getThread(threadId);
      if (!thread || !thread.worktreePath) {
        throw new Error("Thread has no worktree");
      }
      const fullPath = path.join(thread.worktreePath, filePath);
      // Resolve the project path so VS Code opens with the project folder
      const project = storage.getProject(thread.projectId);
      const projectPath = project?.path ?? thread.worktreePath;
      execFile("code", [projectPath, "--goto", fullPath], (err: Error | null) => {
        if (err) {
          shell.openPath(fullPath);
        }
      });
    }
  );

  ipcMain.handle(
    "worktree:openInVSCode",
    async (
      _event,
      filePath: string,
      lineOrProjectPath?: number | string,
      line?: number
    ): Promise<void> => {
      const { execFile } = require("child_process");
      // Support two signatures:
      //   (filePath, line?)
      //   (filePath, projectPath, line?)
      let projectPath: string | undefined;
      let lineNum: number | undefined;
      if (typeof lineOrProjectPath === "string") {
        projectPath = lineOrProjectPath;
        lineNum = line;
      } else {
        lineNum = lineOrProjectPath;
      }
      const target = lineNum ? `${filePath}:${lineNum}` : filePath;
      const args = projectPath ? [projectPath, "--goto", target] : ["--goto", target];
      execFile("code", args, (err: Error | null) => {
        if (err) {
          shell.openPath(filePath);
        }
      });
    }
  );

  // Get current branch for a project
  ipcMain.handle(
    "git:getCurrentBranch",
    async (_event, projectId: string): Promise<string | null> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return null;
      }
      try {
        const git = simpleGit(project.path);
        const branchSummary = await git.branchLocal();
        return branchSummary.current || null;
      } catch {
        return null;
      }
    }
  );

  // Get git diff stats (additions/deletions) for a project
  ipcMain.handle(
    "git:getDiffStats",
    async (_event, projectId: string): Promise<{ additions: number; deletions: number; files: number } | null> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return null;
      }
      try {
        const git = simpleGit(project.path);
        // Get diff stats for unstaged + staged changes
        const diffSummary = await git.diffSummary();
        return {
          additions: diffSummary.insertions,
          deletions: diffSummary.deletions,
          files: diffSummary.files.length,
        };
      } catch {
        return null;
      }
    }
  );

  // Git status - get detailed status of the working tree
  ipcMain.handle(
    "git:status",
    async (_event, projectId: string): Promise<{
      staged: string[];
      modified: string[];
      untracked: string[];
      ahead: number;
      behind: number;
      current: string | null;
    } | null> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return null;
      }
      try {
        const git = simpleGit(project.path);
        const status = await git.status();
        return {
          staged: status.staged,
          modified: status.modified,
          untracked: status.not_added,
          ahead: status.ahead,
          behind: status.behind,
          current: status.current,
        };
      } catch {
        return null;
      }
    }
  );

  // Git add - stage files
  ipcMain.handle(
    "git:add",
    async (_event, projectId: string, files: string[]): Promise<{ success: boolean; error?: string }> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      try {
        const git = simpleGit(project.path);
        if (files.length === 0 || (files.length === 1 && files[0] === ".")) {
          await git.add(".");
        } else {
          await git.add(files);
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Git commit - commit staged changes
  ipcMain.handle(
    "git:commit",
    async (_event, projectId: string, message: string): Promise<{ success: boolean; hash?: string; error?: string }> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      try {
        const git = simpleGit(project.path);
        const result = await git.commit(message);
        return { success: true, hash: result.commit };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Git push - push to remote
  ipcMain.handle(
    "git:push",
    async (_event, projectId: string, remote?: string, branch?: string): Promise<{ success: boolean; error?: string }> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      try {
        const git = simpleGit(project.path);
        if (remote && branch) {
          await git.push(remote, branch);
        } else if (remote) {
          await git.push(remote);
        } else {
          await git.push();
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Git pull - pull from remote
  ipcMain.handle(
    "git:pull",
    async (_event, projectId: string, remote?: string, branch?: string): Promise<{ success: boolean; summary?: string; error?: string }> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      try {
        const git = simpleGit(project.path);
        let result;
        if (remote && branch) {
          result = await git.pull(remote, branch);
        } else if (remote) {
          result = await git.pull(remote);
        } else {
          result = await git.pull();
        }
        const summary = `${result.files.length} files changed, ${result.insertions} insertions, ${result.deletions} deletions`;
        return { success: true, summary };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Git checkout - switch branches or restore files
  ipcMain.handle(
    "git:checkout",
    async (_event, projectId: string, branchOrPath: string, createNew?: boolean): Promise<{ success: boolean; error?: string }> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      try {
        const git = simpleGit(project.path);
        if (createNew) {
          await git.checkoutLocalBranch(branchOrPath);
        } else {
          await git.checkout(branchOrPath);
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Git branch - list, create, or delete branches
  ipcMain.handle(
    "git:branch",
    async (_event, projectId: string, action: "list" | "create" | "delete", branchName?: string): Promise<{
      success: boolean;
      branches?: string[];
      current?: string;
      error?: string
    }> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }
      try {
        const git = simpleGit(project.path);

        switch (action) {
          case "list": {
            const branchSummary = await git.branchLocal();
            return {
              success: true,
              branches: branchSummary.all,
              current: branchSummary.current
            };
          }
          case "create": {
            if (!branchName) {
              return { success: false, error: "Branch name required" };
            }
            await git.checkoutLocalBranch(branchName);
            return { success: true };
          }
          case "delete": {
            if (!branchName) {
              return { success: false, error: "Branch name required" };
            }
            await git.deleteLocalBranch(branchName);
            return { success: true };
          }
          default:
            return { success: false, error: "Invalid action" };
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Dev-only: publish is only available when running from source (not packaged)
  if (!app.isPackaged) {
  ipcMain.handle(
    "git:publish",
    async (_event, projectId: string, version: string): Promise<{
      success: boolean;
      steps: { step: string; success: boolean; message: string }[];
      error?: string;
    }> => {
      const project = storage.getProject(projectId);
      if (!project) {
        return { success: false, steps: [], error: "Project not found" };
      }

      const steps: { step: string; success: boolean; message: string }[] = [];
      const fs = require("fs");
      const path = require("path");

      // Validate version format (should be like 0.4, 0.4.0, 1.0.0, etc.)
      const versionMatch = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
      if (!versionMatch) {
        return { success: false, steps: [], error: "Invalid version format. Use X.Y or X.Y.Z (e.g., 0.4 or 0.4.0)" };
      }

      // Normalize version: if no patch, add .0
      const normalizedVersion = versionMatch[3] !== undefined
        ? version
        : `${version}.0`;
      const displayVersion = `v${version.replace(/^v/, "")}`;

      try {
        const git = simpleGit(project.path);

        // Step 1: Update package.json version
        const packageJsonPath = path.join(project.path, "package.json");
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
          packageJson.version = normalizedVersion;
          fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
          steps.push({ step: "Update package.json", success: true, message: `Version set to ${normalizedVersion}` });
        } catch (err) {
          steps.push({ step: "Update package.json", success: false, message: err instanceof Error ? err.message : String(err) });
          return { success: false, steps, error: "Failed to update package.json" };
        }

        // Step 2: Update Sidebar.tsx version display
        const sidebarPath = path.join(project.path, "src", "components", "layout", "Sidebar.tsx");
        try {
          let sidebarContent = fs.readFileSync(sidebarPath, "utf-8");
          // Replace the version string in Sidebar
          sidebarContent = sidebarContent.replace(
            /v\d+\.\d+(?:\.\d+)?/,
            displayVersion
          );
          fs.writeFileSync(sidebarPath, sidebarContent);
          steps.push({ step: "Update Sidebar version", success: true, message: `Display version set to ${displayVersion}` });
        } catch (err) {
          // Non-fatal - sidebar might not exist or have different structure
          steps.push({ step: "Update Sidebar version", success: false, message: `Skipped: ${err instanceof Error ? err.message : String(err)}` });
        }

        // Step 3: Stage all changes
        try {
          await git.add(".");
          steps.push({ step: "Stage changes", success: true, message: "All changes staged" });
        } catch (err) {
          steps.push({ step: "Stage changes", success: false, message: err instanceof Error ? err.message : String(err) });
          return { success: false, steps, error: "Failed to stage changes" };
        }

        // Step 4: Commit
        try {
          const commitResult = await git.commit(`Release ${displayVersion}`);
          steps.push({ step: "Commit", success: true, message: `Committed: ${commitResult.commit || "OK"}` });
        } catch (err) {
          // Check if nothing to commit
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes("nothing to commit")) {
            steps.push({ step: "Commit", success: true, message: "No changes to commit" });
          } else {
            steps.push({ step: "Commit", success: false, message: errMsg });
            return { success: false, steps, error: "Failed to commit" };
          }
        }

        // Step 5: Push changes
        try {
          await git.push();
          steps.push({ step: "Push changes", success: true, message: "Pushed to remote" });
        } catch (err) {
          steps.push({ step: "Push changes", success: false, message: err instanceof Error ? err.message : String(err) });
          return { success: false, steps, error: "Failed to push changes" };
        }

        // Step 6: Create tag
        const tagName = displayVersion;
        try {
          await git.addTag(tagName);
          steps.push({ step: "Create tag", success: true, message: `Tag ${tagName} created` });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (errMsg.includes("already exists")) {
            steps.push({ step: "Create tag", success: false, message: `Tag ${tagName} already exists` });
            return { success: false, steps, error: `Tag ${tagName} already exists. Use a different version.` };
          }
          steps.push({ step: "Create tag", success: false, message: errMsg });
          return { success: false, steps, error: "Failed to create tag" };
        }

        // Step 7: Push tag
        try {
          await git.pushTags();
          steps.push({ step: "Push tag", success: true, message: `Tag ${tagName} pushed - Release workflow will start` });
        } catch (err) {
          steps.push({ step: "Push tag", success: false, message: err instanceof Error ? err.message : String(err) });
          return { success: false, steps, error: "Failed to push tag" };
        }

        return { success: true, steps };
      } catch (err) {
        return { success: false, steps, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
  } // end dev-only publish guard
}
