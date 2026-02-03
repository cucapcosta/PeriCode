import { ipcMain, BrowserWindow } from "electron";
import { storage } from "../services/storage";
import { projectManager } from "../services/project-manager";
import type {
  Project,
  ProjectSettings,
  ProjectDetectionInfo,
} from "../../src/types/ipc";

export function registerProjectHandlers(): void {
  ipcMain.handle("project:list", (): Project[] => {
    return storage.listProjects();
  });

  ipcMain.handle("project:add", (_event, projectPath: string): Project => {
    return projectManager.addProject(projectPath);
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

  ipcMain.handle(
    "project:openFolder",
    async (_event): Promise<Project | null> => {
      const win = BrowserWindow.getFocusedWindow();
      return projectManager.openFolderDialog(win);
    }
  );

  ipcMain.handle(
    "project:detectInfo",
    (_event, projectId: string): ProjectDetectionInfo => {
      const project = storage.getProject(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      return projectManager.detectProjectInfo(project.path);
    }
  );
}
