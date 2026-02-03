import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseSkillMd,
  loadSkillFile,
  writeSkillFile,
  scanSkillsDirectory,
} from "./skill-parser";
import fs from "fs";
import path from "path";
import os from "os";

let testDir: string;

function createTestDir(): string {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "pericode-skill-test-"));
  return testDir;
}

function cleanupTestDir(): void {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

describe("skill-parser", () => {
  afterEach(() => {
    cleanupTestDir();
  });

  describe("parseSkillMd", () => {
    it("parses a complete SKILL.md with all fields", () => {
      const content = `---
name: Code Review Expert
description: >
  Performs thorough code review focusing on security
model: sonnet
tools:
  - Read
  - Grep
  - Glob
max_budget_usd: 0.50
---

## Instructions

You are a senior code reviewer.
1. Check for security vulnerabilities
2. Identify performance issues`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("Code Review Expert");
      expect(result.description).toContain("thorough code review");
      expect(result.model).toBe("sonnet");
      expect(result.tools).toEqual(["Read", "Grep", "Glob"]);
      expect(result.maxBudgetUsd).toBe(0.5);
      expect(result.instructions).toContain("senior code reviewer");
    });

    it("parses minimal SKILL.md with just name", () => {
      const content = `---
name: Simple Skill
description: A simple skill
---

Do the thing.`;

      const result = parseSkillMd(content);
      expect(result.name).toBe("Simple Skill");
      expect(result.description).toBe("A simple skill");
      expect(result.model).toBeUndefined();
      expect(result.tools).toBeUndefined();
      expect(result.maxBudgetUsd).toBeUndefined();
      expect(result.instructions).toBe("Do the thing.");
    });

    it("throws when missing frontmatter delimiters", () => {
      expect(() => parseSkillMd("no frontmatter here")).toThrow(
        "must start with ---"
      );
    });

    it("throws when missing closing delimiter", () => {
      expect(() => parseSkillMd("---\nname: Test\n")).toThrow(
        "missing closing ---"
      );
    });

    it("throws when name is missing", () => {
      expect(() =>
        parseSkillMd("---\ndescription: no name\n---\ncontent")
      ).toThrow("must include 'name'");
    });
  });

  describe("loadSkillFile and writeSkillFile", () => {
    beforeEach(() => {
      createTestDir();
    });

    it("writes and reads back a skill file", () => {
      const skillDir = path.join(testDir, "test-skill");

      writeSkillFile(skillDir, {
        name: "Test Skill",
        description: "A test skill for testing",
        model: "opus",
        tools: ["Read", "Write"],
        maxBudgetUsd: 1.0,
        instructions: "## Instructions\n\nDo the testing.",
        rawContent: "",
      });

      expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);

      const loaded = loadSkillFile(path.join(skillDir, "SKILL.md"));
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe("Test Skill");
      expect(loaded!.description).toContain("test skill");
      expect(loaded!.model).toBe("opus");
      expect(loaded!.tools).toEqual(["Read", "Write"]);
      expect(loaded!.maxBudgetUsd).toBe(1.0);
    });

    it("returns null for non-existent file", () => {
      const result = loadSkillFile(path.join(testDir, "nonexistent", "SKILL.md"));
      expect(result).toBeNull();
    });
  });

  describe("scanSkillsDirectory", () => {
    beforeEach(() => {
      createTestDir();
    });

    it("finds all skills in a directory", () => {
      // Create two skill directories
      writeSkillFile(path.join(testDir, "skill-a"), {
        name: "Skill A",
        description: "First skill",
        instructions: "Do A",
        rawContent: "",
      });

      writeSkillFile(path.join(testDir, "skill-b"), {
        name: "Skill B",
        description: "Second skill",
        model: "haiku",
        instructions: "Do B",
        rawContent: "",
      });

      const results = scanSkillsDirectory(testDir);
      expect(results.length).toBe(2);
      expect(results.some((r) => r.parsed.name === "Skill A")).toBe(true);
      expect(results.some((r) => r.parsed.name === "Skill B")).toBe(true);
    });

    it("returns empty array for non-existent directory", () => {
      const results = scanSkillsDirectory(path.join(testDir, "nonexistent"));
      expect(results).toEqual([]);
    });
  });
});
