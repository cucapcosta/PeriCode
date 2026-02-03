import { ipcMain } from "electron";
import { skillsEngine } from "../services/skills-engine";
import type { Skill, SkillDetail, SkillDefinition } from "../../src/types/ipc";

export function registerSkillHandlers(): void {
  ipcMain.handle("skill:list", async (): Promise<Skill[]> => {
    return skillsEngine.loadAll();
  });

  ipcMain.handle("skill:get", (_event, id: string): SkillDetail => {
    const detail = skillsEngine.getDetail(id);
    if (!detail) throw new Error(`Skill not found: ${id}`);
    return detail;
  });

  ipcMain.handle(
    "skill:create",
    async (_event, definition: SkillDefinition): Promise<Skill> => {
      return skillsEngine.create(definition);
    }
  );

  ipcMain.handle(
    "skill:update",
    async (
      _event,
      id: string,
      definition: SkillDefinition
    ): Promise<Skill> => {
      return skillsEngine.update(id, definition);
    }
  );

  ipcMain.handle("skill:delete", async (_event, id: string): Promise<void> => {
    return skillsEngine.delete(id);
  });

  ipcMain.handle(
    "skill:export",
    async (_event, _id: string): Promise<{ path: string }> => {
      // Export as .zip will be implemented when needed
      throw new Error("Skill export not yet implemented");
    }
  );

  ipcMain.handle(
    "skill:import",
    async (_event, _archivePath: string): Promise<Skill> => {
      // Import from .zip will be implemented when needed
      throw new Error("Skill import not yet implemented");
    }
  );
}
