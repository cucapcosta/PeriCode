import { dialog, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { logger } from "../utils/logger";
import type { Project } from "../../src/types/ipc";

export interface ProjectDetectionInfo {
  isGitRepo: boolean;
  hasClaudeMd: boolean;
  hasAgentsMd: boolean;
  claudeMdContent: string | null;
  agentsMdContent: string | null;
  defaultBranch: string | null;
}

class ProjectManager {
  /**
   * Open a native folder dialog and add the selected folder as a project.
   * Returns the new Project or null if the user cancelled.
   */
  async openFolderDialog(
    parentWindow: BrowserWindow | null
  ): Promise<Project | null> {
    const result = await dialog.showOpenDialog(
      parentWindow || (BrowserWindow.getFocusedWindow() as BrowserWindow),
      {
        properties: ["openDirectory"],
        title: "Open Project Folder",
      }
    );

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const folderPath = result.filePaths[0];
    return this.addProject(folderPath);
  }

  /**
   * Add a project by path. Detects git info and reads config files.
   */
  addProject(folderPath: string): Project {
    // Check if project already exists
    const existing = storage.listProjects();
    const found = existing.find(
      (p) => path.resolve(p.path) === path.resolve(folderPath)
    );
    if (found) {
      logger.info("project-manager", `Project already exists: ${folderPath}`);
      return found;
    }

    const id = crypto.randomUUID();
    const name = path.basename(folderPath);
    const project = storage.addProject(id, name, folderPath);

    // Detect project info and update settings with any found config
    const info = this.detectProjectInfo(folderPath);
    if (info.claudeMdContent) {
      storage.updateProjectSettings(id, {
        systemPrompt: info.claudeMdContent,
      });
    }

    logger.info(
      "project-manager",
      `Added project: ${name} (git: ${info.isGitRepo})`
    );
    return storage.getProject(id) || project;
  }

  /**
   * Detect project characteristics: git repo, CLAUDE.md, AGENTS.md
   */
  detectProjectInfo(projectPath: string): ProjectDetectionInfo {
    const info: ProjectDetectionInfo = {
      isGitRepo: false,
      hasClaudeMd: false,
      hasAgentsMd: false,
      claudeMdContent: null,
      agentsMdContent: null,
      defaultBranch: null,
    };

    try {
      // Check for .git directory
      const gitPath = path.join(projectPath, ".git");
      info.isGitRepo =
        fs.existsSync(gitPath) &&
        (fs.statSync(gitPath).isDirectory() || fs.statSync(gitPath).isFile());

      // Read default branch from HEAD if git repo
      if (info.isGitRepo) {
        try {
          const headPath = path.join(projectPath, ".git", "HEAD");
          if (fs.existsSync(headPath)) {
            const headContent = fs.readFileSync(headPath, "utf-8").trim();
            const match = headContent.match(/^ref: refs\/heads\/(.+)$/);
            if (match) {
              info.defaultBranch = match[1];
            }
          }
        } catch {
          // Ignore HEAD read failures
        }
      }

      // Check for CLAUDE.md
      const claudeMdPath = path.join(projectPath, "CLAUDE.md");
      if (fs.existsSync(claudeMdPath)) {
        info.hasClaudeMd = true;
        info.claudeMdContent = fs.readFileSync(claudeMdPath, "utf-8");
      }

      // Check for AGENTS.md
      const agentsMdPath = path.join(projectPath, "AGENTS.md");
      if (fs.existsSync(agentsMdPath)) {
        info.hasAgentsMd = true;
        info.agentsMdContent = fs.readFileSync(agentsMdPath, "utf-8");
      }
    } catch (err) {
      logger.warn(
        "project-manager",
        `Error detecting project info for ${projectPath}`,
        err
      );
    }

    return info;
  }

  /**
   * Update the last_opened_at timestamp for a project.
   */
  touchProject(projectId: string): void {
    const project = storage.getProject(projectId);
    if (!project) return;

    // Update last_opened_at via raw SQL since storage doesn't expose this directly
    // For now we just rely on the storage layer's existing data
    logger.debug("project-manager", `Touched project: ${projectId}`);
  }

  /**
   * Get projects sorted by most recently opened.
   */
  getRecentProjects(limit = 10): Project[] {
    const projects = storage.listProjects();
    return projects
      .sort((a, b) => {
        const aTime = a.lastOpenedAt
          ? new Date(a.lastOpenedAt).getTime()
          : new Date(a.createdAt).getTime();
        const bTime = b.lastOpenedAt
          ? new Date(b.lastOpenedAt).getTime()
          : new Date(b.createdAt).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }
}

export const projectManager = new ProjectManager();
