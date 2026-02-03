import { ipcMain } from "electron";
import type { Project, ProjectSettings } from "../../src/types/ipc";

// Placeholder implementations - will be connected to storage in Phase 1.3
const projects: Map<string, Project> = new Map();

export function registerProjectHandlers(): void {
  ipcMain.handle("project:list", (): Project[] => {
    return Array.from(projects.values());
  });

  ipcMain.handle("project:add", (_event, projectPath: string): Project => {
    const id = crypto.randomUUID();
    const name = projectPath.split(/[\\/]/).pop() || "Unnamed";
    const project: Project = {
      id,
      name,
      path: projectPath,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      settings: {},
    };
    projects.set(id, project);
    return project;
  });

  ipcMain.handle("project:remove", (_event, id: string): void => {
    projects.delete(id);
  });

  ipcMain.handle(
    "project:getSettings",
    (_event, id: string): ProjectSettings => {
      const project = projects.get(id);
      if (!project) {
        throw new Error(`Project not found: ${id}`);
      }
      return project.settings;
    }
  );

  ipcMain.handle(
    "project:updateSettings",
    (_event, id: string, settings: Partial<ProjectSettings>): void => {
      const project = projects.get(id);
      if (!project) {
        throw new Error(`Project not found: ${id}`);
      }
      project.settings = { ...project.settings, ...settings };
    }
  );
}
