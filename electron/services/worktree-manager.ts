import simpleGit, { SimpleGit } from "simple-git";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import { getWorktreeBasePath } from "../utils/paths";
import type { WorktreeInfo, FileDiff, GitStatus } from "../../src/types/ipc";

class WorktreeManager {
  private getGit(repoPath: string): SimpleGit {
    return simpleGit(repoPath);
  }

  /**
   * Create a new worktree for an agent thread.
   * Branch naming: pericode/<threadId>/<shortDescription>
   */
  async create(
    repoPath: string,
    threadId: string,
    description?: string
  ): Promise<WorktreeInfo> {
    const git = this.getGit(repoPath);

    // Ensure the base worktree directory exists
    const basePath = getWorktreeBasePath(repoPath);
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }

    // Create branch name from thread ID and optional description
    const shortDesc = description
      ? description
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 30)
      : "work";
    const branchName = `pericode/${threadId.slice(0, 8)}/${shortDesc}`;
    const worktreePath = path.join(basePath, threadId.slice(0, 8));

    // Get current HEAD commit
    const headLog = await git.log({ maxCount: 1 });
    const commitHash = headLog.latest?.hash ?? "HEAD";

    // Create the worktree with a new branch from current HEAD
    await git.raw(["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);

    logger.info(
      "worktree-manager",
      `Created worktree at ${worktreePath} on branch ${branchName}`
    );

    return {
      path: worktreePath,
      branch: branchName,
      commitHash,
      isMain: false,
    };
  }

  /**
   * Destroy a worktree and clean up its branch.
   */
  async destroy(repoPath: string, worktreePath: string): Promise<void> {
    const git = this.getGit(repoPath);

    // Get the branch name before removing
    const worktrees = await this.list(repoPath);
    const wt = worktrees.find(
      (w) => path.resolve(w.path) === path.resolve(worktreePath)
    );
    const branchToDelete = wt?.branch;

    // Remove the worktree (force to handle dirty state)
    await git.raw(["worktree", "remove", worktreePath, "--force"]);

    // Delete the branch if it was a pericode branch
    if (branchToDelete && branchToDelete.startsWith("pericode/")) {
      try {
        await git.deleteLocalBranch(branchToDelete, true);
        logger.info(
          "worktree-manager",
          `Deleted branch ${branchToDelete}`
        );
      } catch (err) {
        logger.warn(
          "worktree-manager",
          `Failed to delete branch ${branchToDelete}`,
          err
        );
      }
    }

    logger.info("worktree-manager", `Destroyed worktree at ${worktreePath}`);
  }

  /**
   * List all worktrees for a repository.
   */
  async list(repoPath: string): Promise<WorktreeInfo[]> {
    const git = this.getGit(repoPath);

    const result = await git.raw(["worktree", "list", "--porcelain"]);
    const worktrees: WorktreeInfo[] = [];

    // Parse porcelain output
    const blocks = result.trim().split("\n\n");
    for (const block of blocks) {
      if (!block.trim()) continue;

      const lines = block.trim().split("\n");
      let wtPath = "";
      let branch = "";
      let commitHash = "";
      let isMain = false;

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          wtPath = line.slice("worktree ".length);
        } else if (line.startsWith("HEAD ")) {
          commitHash = line.slice("HEAD ".length);
        } else if (line.startsWith("branch ")) {
          // branch refs/heads/main -> main
          branch = line.slice("branch ".length).replace("refs/heads/", "");
        } else if (line === "bare") {
          isMain = true;
        }
      }

      // The first worktree is the main one
      if (worktrees.length === 0 && !branch.startsWith("pericode/")) {
        isMain = true;
      }

      if (wtPath) {
        worktrees.push({ path: wtPath, branch, commitHash, isMain });
      }
    }

    return worktrees;
  }

  /**
   * Get the diff of all changes in a worktree compared to its base.
   */
  async getDiff(worktreePath: string): Promise<FileDiff[]> {
    const git = this.getGit(worktreePath);
    const diffs: FileDiff[] = [];

    // Get diff summary against the parent branch (HEAD~1 or main)
    const diffSummary = await git.diffSummary(["HEAD~1"]).catch(() =>
      // If no parent commit, diff against empty tree
      git.diffSummary(["--cached"])
    );

    for (const file of diffSummary.files) {
      let status: FileDiff["status"] = "modified";
      if ("insertions" in file) {
        const ins = file.insertions ?? 0;
        const del = file.deletions ?? 0;
        if (ins > 0 && del === 0) status = "added";
        else if (ins === 0 && del > 0) status = "deleted";
      }

      diffs.push({
        path: file.file,
        status,
        additions: "insertions" in file ? (file.insertions ?? 0) : 0,
        deletions: "deletions" in file ? (file.deletions ?? 0) : 0,
      });
    }

    return diffs;
  }

  /**
   * Sync changes from a worktree branch back to a target branch.
   * Creates a merge commit on the target branch.
   */
  async syncBack(
    repoPath: string,
    worktreePath: string,
    targetBranch: string
  ): Promise<void> {
    const worktreeGit = this.getGit(worktreePath);
    const mainGit = this.getGit(repoPath);

    // First, commit any uncommitted changes in the worktree
    const status = await worktreeGit.status();
    if (!status.isClean()) {
      await worktreeGit.add("-A");
      await worktreeGit.commit("PeriCode agent changes");
    }

    // Get the worktree branch name
    const currentBranch = await worktreeGit.revparse(["--abbrev-ref", "HEAD"]);

    // Merge the worktree branch into the target
    await mainGit.merge([currentBranch.trim(), "--no-ff", "-m", `Merge PeriCode agent work from ${currentBranch.trim()}`]);

    logger.info(
      "worktree-manager",
      `Synced ${currentBranch.trim()} back to ${targetBranch}`
    );
  }

  /**
   * Get the git status of a worktree.
   */
  async getStatus(worktreePath: string): Promise<GitStatus> {
    const git = this.getGit(worktreePath);
    const status = await git.status();

    return {
      modified: status.modified,
      added: status.created,
      deleted: status.deleted,
      renamed: status.renamed.map((r) => r.to),
      untracked: status.not_added,
      staged: status.staged,
      conflicted: status.conflicted,
      isClean: status.isClean(),
    };
  }

  /**
   * Clean up orphaned worktrees (e.g., from app crashes).
   * Removes worktrees whose directories no longer exist.
   */
  async cleanupOrphaned(repoPath: string): Promise<void> {
    try {
      const git = this.getGit(repoPath);
      await git.raw(["worktree", "prune"]);
      logger.info("worktree-manager", "Pruned orphaned worktrees");
    } catch (err) {
      logger.warn("worktree-manager", "Failed to prune worktrees", err);
    }
  }
}

export const worktreeManager = new WorktreeManager();
