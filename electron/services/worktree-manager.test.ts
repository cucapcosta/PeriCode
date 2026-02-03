import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { worktreeManager } from "./worktree-manager";
import fs from "fs";
import path from "path";
import os from "os";
import simpleGit from "simple-git";

/**
 * These tests create real git repos in temp directories.
 * They test the worktree manager's core functionality.
 */

let testDir: string;
let repoPath: string;

async function createTestRepo(): Promise<string> {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pericode-wt-test-"));
  repoPath = path.join(testDir, "repo");
  fs.mkdirSync(repoPath, { recursive: true });

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");

  // Create an initial commit so we have a valid HEAD
  const testFile = path.join(repoPath, "README.md");
  fs.writeFileSync(testFile, "# Test Repo\n");
  await git.add(".");
  await git.commit("initial commit");

  return repoPath;
}

function cleanupTestDir(): void {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

describe("worktree-manager", () => {
  beforeEach(async () => {
    await createTestRepo();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it("creates a worktree with a new branch", async () => {
    const threadId = "abcd1234-5678-9012-3456-789012345678";
    const wt = await worktreeManager.create(repoPath, threadId, "test feature");

    expect(wt.path).toContain("abcd1234");
    expect(wt.branch).toBe("pericode/abcd1234/test-feature");
    expect(wt.isMain).toBe(false);
    expect(fs.existsSync(wt.path)).toBe(true);

    // Verify the README exists in the worktree
    expect(fs.existsSync(path.join(wt.path, "README.md"))).toBe(true);
  });

  it("lists worktrees including main and created ones", async () => {
    const threadId = "bbbb1234-5678-9012-3456-789012345678";
    await worktreeManager.create(repoPath, threadId, "feature");

    const worktrees = await worktreeManager.list(repoPath);
    expect(worktrees.length).toBe(2); // main + created one
    expect(worktrees.some((w) => w.isMain)).toBe(true);
    expect(worktrees.some((w) => w.branch.startsWith("pericode/"))).toBe(true);
  });

  it("destroys a worktree and its branch", async () => {
    const threadId = "cccc1234-5678-9012-3456-789012345678";
    const wt = await worktreeManager.create(repoPath, threadId, "temp");

    // Verify it exists
    expect(fs.existsSync(wt.path)).toBe(true);

    // Destroy it
    await worktreeManager.destroy(repoPath, wt.path);

    // Verify the worktree directory is gone
    expect(fs.existsSync(wt.path)).toBe(false);

    // Verify only 1 worktree remains (the main one)
    const remaining = await worktreeManager.list(repoPath);
    expect(remaining.length).toBe(1);
  });

  it("gets status of a worktree", async () => {
    const threadId = "dddd1234-5678-9012-3456-789012345678";
    const wt = await worktreeManager.create(repoPath, threadId, "status-test");

    // Initially clean
    const cleanStatus = await worktreeManager.getStatus(wt.path);
    expect(cleanStatus.isClean).toBe(true);

    // Create a new file
    fs.writeFileSync(path.join(wt.path, "new-file.txt"), "hello");
    const dirtyStatus = await worktreeManager.getStatus(wt.path);
    expect(dirtyStatus.isClean).toBe(false);
    expect(dirtyStatus.untracked.length).toBeGreaterThan(0);
  });

  it("gets diff of changes in a worktree", async () => {
    const threadId = "eeee1234-5678-9012-3456-789012345678";
    const wt = await worktreeManager.create(repoPath, threadId, "diff-test");

    // Make some changes and commit them
    const wtGit = simpleGit(wt.path);
    fs.writeFileSync(path.join(wt.path, "new-file.txt"), "new content\n");
    await wtGit.add(".");
    await wtGit.commit("add new file");

    const diffs = await worktreeManager.getDiff(wt.path);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some((d) => d.path === "new-file.txt")).toBe(true);
  });

  it("cleans up orphaned worktrees without error", async () => {
    // This should not throw even when there are no orphans
    await expect(
      worktreeManager.cleanupOrphaned(repoPath)
    ).resolves.not.toThrow();
  });
});
