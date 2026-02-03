import { ipcMain } from "electron";
import { storage } from "../services/storage";
import type { Project, ProjectSettings } from "../../src/types/ipc";

export function registerProjectHandlers(): void {
  ipcMain.handle("project:list", (): Project[] => {
    return storage.listProjects();
  });

  ipcMain.handle("project:add", (_event, projectPath: string): Project => {
    const id = crypto.randomUUID();
    const name = projectPath.split(/[\\/]/).pop() || "Unnamed";
    return storage.addProject(id, name, projectPath);
  });

  ipcMain.handle("project:remove", (_event, id: string): void => {
    storage.removeProject(id);
  });

  ipcMain.handle(
    "project:getSettings",
    (_event, id: string): ProjectSettings => {
      const project = storage.getProject(id);
      if (!project) throw new Error(`Project not found: ${id}`);
      return project.settings;
    }
  );

  ipcMain.handle(
    "project:updateSettings",
    (_event, id: string, settings: Partial<ProjectSettings>): void => {
      storage.updateProjectSettings(id, settings);
    }
  );
}
