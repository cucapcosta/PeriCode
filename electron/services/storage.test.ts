import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { storage } from "./storage";
import fs from "fs";
import path from "path";
import os from "os";

let testDbPath: string;

beforeEach(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pericode-test-"));
  testDbPath = path.join(tmpDir, "test.db");
  await storage.initialize(testDbPath);
});

afterEach(() => {
  storage.close();
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  const dir = path.dirname(testDbPath);
  if (fs.existsSync(dir)) {
    fs.rmdirSync(dir);
  }
});

describe("storage - projects", () => {
  it("adds and lists projects", () => {
    storage.addProject("p1", "Test Project", "/tmp/test-project");
    const projects = storage.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe("p1");
    expect(projects[0].name).toBe("Test Project");
    expect(projects[0].path).toBe("/tmp/test-project");
  });

  it("gets a project by id", () => {
    storage.addProject("p1", "Test", "/tmp/test");
    const project = storage.getProject("p1");
    expect(project).not.toBeNull();
    expect(project?.name).toBe("Test");
  });

  it("returns null for non-existent project", () => {
    const project = storage.getProject("nonexistent");
    expect(project).toBeNull();
  });

  it("removes a project and its related data", () => {
    storage.addProject("p1", "Test", "/tmp/test");
    storage.createThread("t1", "p1", "Thread 1", null, null, null);
    storage.addMessage("m1", "t1", "user", [{ type: "text", text: "hello" }], null, null, null);

    storage.removeProject("p1");
    expect(storage.listProjects()).toHaveLength(0);
    expect(storage.getThread("t1")).toBeNull();
  });

  it("updates project settings", () => {
    storage.addProject("p1", "Test", "/tmp/test");
    storage.updateProjectSettings("p1", { model: "opus", maxBudgetUsd: 5.0 });
    const project = storage.getProject("p1");
    expect(project?.settings.model).toBe("opus");
    expect(project?.settings.maxBudgetUsd).toBe(5.0);
  });
});

describe("storage - threads", () => {
  beforeEach(() => {
    storage.addProject("p1", "Test", "/tmp/test");
  });

  it("creates and lists threads", () => {
    storage.createThread("t1", "p1", "Thread 1", null, null, null);
    storage.createThread("t2", "p1", "Thread 2", null, null, null);
    const threads = storage.listThreads("p1");
    expect(threads).toHaveLength(2);
  });

  it("updates thread status", () => {
    storage.createThread("t1", "p1", "Thread 1", null, null, null);
    storage.updateThreadStatus("t1", "completed");
    const thread = storage.getThread("t1");
    expect(thread?.status).toBe("completed");
  });

  it("deletes thread and its messages", () => {
    storage.createThread("t1", "p1", "Thread 1", null, null, null);
    storage.addMessage("m1", "t1", "user", [{ type: "text", text: "hi" }], null, null, null);
    storage.deleteThread("t1");
    expect(storage.getThread("t1")).toBeNull();
    expect(storage.listMessages("t1")).toHaveLength(0);
  });
});

describe("storage - messages", () => {
  beforeEach(() => {
    storage.addProject("p1", "Test", "/tmp/test");
    storage.createThread("t1", "p1", "Thread 1", null, null, null);
  });

  it("adds and lists messages in order", () => {
    storage.addMessage("m1", "t1", "user", [{ type: "text", text: "Hello" }], null, null, null);
    storage.addMessage("m2", "t1", "assistant", [{ type: "text", text: "Hi there" }], 0.01, 100, 50);

    const messages = storage.listMessages("t1");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content[0].text).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].costUsd).toBe(0.01);
  });
});

describe("storage - skills", () => {
  it("adds and lists skills", () => {
    storage.addSkill("s1", "Code Review", "Reviews code", "system", "/skills/code-review");
    const skills = storage.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("Code Review");
    expect(skills[0].scope).toBe("system");
  });

  it("deletes a skill", () => {
    storage.addSkill("s1", "Test", "Test skill", "user", "/skills/test");
    storage.deleteSkill("s1");
    expect(storage.listSkills()).toHaveLength(0);
  });
});

describe("storage - app settings", () => {
  it("returns defaults when no settings saved", () => {
    const settings = storage.getAppSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.defaultModel).toBe("sonnet");
    expect(settings.maxConcurrentAgents).toBe(3);
  });

  it("updates and persists settings", () => {
    storage.updateAppSettings({ theme: "light", fontSize: 16 });
    const settings = storage.getAppSettings();
    expect(settings.theme).toBe("light");
    expect(settings.fontSize).toBe(16);
    expect(settings.defaultModel).toBe("sonnet"); // unchanged
  });
});

describe("storage - persistence", () => {
  it("persists data across close and reopen", async () => {
    storage.addProject("p1", "Persistent", "/tmp/persist");
    storage.close();

    await storage.initialize(testDbPath);
    const projects = storage.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Persistent");
  });
});
