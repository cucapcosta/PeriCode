import { ipcMain } from "electron";
import { terminalService } from "../services/terminal-service";

export function registerTerminalHandlers(): void {
  ipcMain.handle(
    "terminal:create",
    (_event, id: string, cwd: string): void => {
      terminalService.create(id, cwd);
    }
  );

  ipcMain.handle(
    "terminal:write",
    (_event, id: string, data: string): void => {
      terminalService.write(id, data);
    }
  );

  ipcMain.handle(
    "terminal:resize",
    (_event, id: string, cols: number, rows: number): void => {
      terminalService.resize(id, cols, rows);
    }
  );

  ipcMain.handle("terminal:destroy", (_event, id: string): void => {
    terminalService.destroy(id);
  });

  ipcMain.handle("terminal:list", (): string[] => {
    return terminalService.getActiveIds();
  });
}
