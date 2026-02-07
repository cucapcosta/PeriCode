import { registerProjectHandlers } from "./projects.ipc";
import { registerAgentHandlers } from "./agents.ipc";
import { registerSettingsHandlers } from "./settings.ipc";
import { registerWorktreeHandlers } from "./worktrees.ipc";
import { registerSkillHandlers } from "./skills.ipc";
import { registerAutomationHandlers } from "./automations.ipc";
import { registerStatusHandlers } from "./status.ipc";
import { registerTerminalHandlers } from "./terminal.ipc";
import { registerExportHandlers } from "./export.ipc";
import { registerNotesHandlers } from "./notes.ipc";
import { registerImageHandlers } from "./images.ipc";
import { registerCommandHandlers } from "./commands.ipc";

export function registerAllIPCHandlers(): void {
  registerProjectHandlers();
  registerAgentHandlers();
  registerSettingsHandlers();
  registerWorktreeHandlers();
  registerSkillHandlers();
  registerAutomationHandlers();
  registerStatusHandlers();
  registerTerminalHandlers();
  registerExportHandlers();
  registerNotesHandlers();
  registerImageHandlers();
  registerCommandHandlers();
}
