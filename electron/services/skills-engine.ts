import path from "path";
import fs from "fs";
import { storage } from "./storage";
import {
  parseSkillMd,
  loadSkillFile,
  writeSkillFile,
  scanSkillsDirectory,
  type ParsedSkillDefinition,
} from "./skill-parser";
import { getSkillsPath } from "../utils/paths";
import { logger } from "../utils/logger";
import { simpleGit } from "simple-git";
import type { Skill, SkillDetail, SkillDefinition } from "../../src/types/ipc";

// Path to built-in skills shipped with the app
const BUILTIN_SKILLS_PATH = path.join(__dirname, "../../skills");

/**
 * Configuration generated from a skill for use with an agent.
 */
export interface SkillConfig {
  systemPrompt: string;
  tools: string[];
  model?: string;
  maxBudgetUsd?: number;
}

class SkillsEngine {
  /**
   * Load all skills from all scopes: system (built-in), user, project.
   */
  async loadAll(): Promise<Skill[]> {
    const skills: Skill[] = [];

    // 1. Load system (built-in) skills
    const builtinSkills = scanSkillsDirectory(BUILTIN_SKILLS_PATH);
    for (const { dirName, path: skillPath, parsed } of builtinSkills) {
      const existing = storage.listSkills().find(
        (s) => s.name === parsed.name && s.scope === "system"
      );
      if (existing) {
        skills.push(existing);
      } else {
        // Register in storage
        const id = crypto.randomUUID();
        const skill = storage.addSkill(id, parsed.name, parsed.description, "system", skillPath);
        skills.push(skill);
      }
    }

    // 2. Load user skills
    const userSkillsPath = getSkillsPath();
    const userSkills = scanSkillsDirectory(userSkillsPath);
    for (const { dirName, path: skillPath, parsed } of userSkills) {
      const existing = storage.listSkills().find(
        (s) => s.name === parsed.name && s.scope === "user"
      );
      if (existing) {
        skills.push(existing);
      } else {
        const id = crypto.randomUUID();
        const skill = storage.addSkill(id, parsed.name, parsed.description, "user", skillPath);
        skills.push(skill);
      }
    }

    // 3. Load from storage (covers project skills and previously registered)
    const storedSkills = storage.listSkills();
    for (const stored of storedSkills) {
      if (!skills.some((s) => s.id === stored.id)) {
        skills.push(stored);
      }
    }

    return skills;
  }

  /**
   * Resolve a skill by name, checking in priority order: project > user > system.
   */
  resolve(name: string): Skill | undefined {
    const allSkills = storage.listSkills();
    // Priority: project > user > system
    const scopeOrder: Array<Skill["scope"]> = ["project", "user", "system"];

    for (const scope of scopeOrder) {
      const found = allSkills.find(
        (s) => s.name.toLowerCase() === name.toLowerCase() && s.scope === scope
      );
      if (found) return found;
    }

    // Try partial match
    return allSkills.find((s) =>
      s.name.toLowerCase().includes(name.toLowerCase())
    );
  }

  /**
   * Match skills against a user prompt using keyword matching.
   * Returns skills whose description keywords appear in the prompt.
   */
  match(prompt: string): Skill[] {
    const allSkills = storage.listSkills();
    const promptLower = prompt.toLowerCase();
    const matched: Array<{ skill: Skill; score: number }> = [];

    for (const skill of allSkills) {
      const descWords = skill.description
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const nameWords = skill.name.toLowerCase().split(/\s+/);
      const allWords = [...nameWords, ...descWords];

      let score = 0;
      for (const word of allWords) {
        if (promptLower.includes(word)) {
          score++;
        }
      }

      if (score > 0) {
        matched.push({ skill, score });
      }
    }

    // Sort by score descending
    matched.sort((a, b) => b.score - a.score);
    return matched.map((m) => m.skill);
  }

  /**
   * Build an agent configuration from a skill.
   * Returns system prompt, tools, model, and budget constraints.
   */
  invoke(skill: Skill): SkillConfig {
    const parsed = loadSkillFile(path.join(skill.path, "SKILL.md"));
    if (!parsed) {
      throw new Error(`Failed to load skill file for ${skill.name}`);
    }

    return {
      systemPrompt: parsed.instructions,
      tools: parsed.tools ?? [],
      model: parsed.model,
      maxBudgetUsd: parsed.maxBudgetUsd,
    };
  }

  /**
   * Get detailed information about a skill including its content.
   */
  getDetail(id: string): SkillDetail | null {
    const skill = storage.listSkills().find((s) => s.id === id);
    if (!skill) return null;

    const parsed = loadSkillFile(path.join(skill.path, "SKILL.md"));
    if (!parsed) return null;

    return {
      ...skill,
      content: parsed.rawContent,
      model: parsed.model,
      tools: parsed.tools,
      maxBudgetUsd: parsed.maxBudgetUsd,
    };
  }

  /**
   * Create a new user skill.
   */
  async create(definition: SkillDefinition): Promise<Skill> {
    const skillsBase = getSkillsPath();
    const dirName = definition.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+$/, "");
    const skillDir = path.join(skillsBase, dirName);

    const parsed: ParsedSkillDefinition = {
      name: definition.name,
      description: definition.description,
      model: definition.model,
      tools: definition.tools,
      maxBudgetUsd: definition.maxBudgetUsd,
      instructions: definition.content,
      rawContent: "",
    };

    writeSkillFile(skillDir, parsed);

    const id = crypto.randomUUID();
    const scope = definition.scope ?? "user";
    return storage.addSkill(id, definition.name, definition.description, scope, skillDir);
  }

  /**
   * Update an existing skill.
   */
  async update(id: string, definition: SkillDefinition): Promise<Skill> {
    const existing = storage.listSkills().find((s) => s.id === id);
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

    const parsed: ParsedSkillDefinition = {
      name: definition.name,
      description: definition.description,
      model: definition.model,
      tools: definition.tools,
      maxBudgetUsd: definition.maxBudgetUsd,
      instructions: definition.content,
      rawContent: "",
    };

    writeSkillFile(existing.path, parsed);

    // Update in storage
    storage.deleteSkill(id);
    return storage.addSkill(id, definition.name, definition.description, existing.scope, existing.path);
  }

  /**
   * Delete a skill.
   */
  async delete(id: string): Promise<void> {
    storage.deleteSkill(id);
  }

  /**
   * Import skills from a Git repository URL.
   * Clones the repo and recursively finds all SKILL.md files.
   */
  async importFromGit(gitUrl: string): Promise<Skill[]> {
    const skillsBase = getSkillsPath();

    // Ensure skills directory exists
    if (!fs.existsSync(skillsBase)) {
      fs.mkdirSync(skillsBase, { recursive: true });
    }

    // Extract repo name from URL for the directory name
    const repoName = gitUrl
      .replace(/\.git$/, "")
      .split("/")
      .pop()
      ?.replace(/[^a-zA-Z0-9-_]/g, "-") || `skill-${Date.now()}`;

    const targetDir = path.join(skillsBase, repoName);

    // Check if directory already exists
    if (fs.existsSync(targetDir)) {
      // Try to pull latest changes instead
      logger.info("skills-engine", `Directory ${targetDir} exists, pulling latest changes`);
      const git = simpleGit(targetDir);
      await git.pull();
    } else {
      // Clone the repository
      logger.info("skills-engine", `Cloning ${gitUrl} to ${targetDir}`);
      const git = simpleGit();
      await git.clone(gitUrl, targetDir);
    }

    // Recursively find all SKILL.md files
    const skillFiles = this.findSkillFilesRecursive(targetDir);
    logger.info("skills-engine", `Found ${skillFiles.length} SKILL.md files`);

    const importedSkills: Skill[] = [];

    for (const skillFilePath of skillFiles) {
      const parsed = loadSkillFile(skillFilePath);
      if (parsed) {
        // The skill directory is the parent of SKILL.md
        const skillDir = path.dirname(skillFilePath);

        // Check if this skill already exists (by path)
        const existingSkills = storage.listSkills();
        const alreadyExists = existingSkills.some(s => s.path === skillDir);

        if (!alreadyExists) {
          const id = crypto.randomUUID();
          const skill = storage.addSkill(
            id,
            parsed.name,
            parsed.description,
            "user",
            skillDir
          );
          importedSkills.push(skill);
          logger.info("skills-engine", `Imported skill: ${parsed.name}`);
        } else {
          logger.info("skills-engine", `Skill already exists: ${parsed.name}`);
        }
      }
    }

    if (importedSkills.length === 0 && skillFiles.length === 0) {
      throw new Error("No SKILL.md files found in repository.");
    }

    if (importedSkills.length === 0) {
      throw new Error("All skills from this repository are already imported.");
    }

    return importedSkills;
  }

  /**
   * Recursively find all SKILL.md files in a directory.
   */
  private findSkillFilesRecursive(dir: string): string[] {
    const results: string[] = [];

    const scan = (currentDir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories and common non-skill directories
          if (entry.name.startsWith(".") ||
              entry.name === "node_modules" ||
              entry.name === "__pycache__") {
            continue;
          }
          scan(fullPath);
        } else if (entry.isFile() && entry.name === "SKILL.md") {
          results.push(fullPath);
        }
      }
    };

    scan(dir);
    return results;
  }
}

export const skillsEngine = new SkillsEngine();
