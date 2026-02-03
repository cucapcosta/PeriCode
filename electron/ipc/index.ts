import { registerProjectHandlers } from "./projects.ipc";
import { registerAgentHandlers } from "./agents.ipc";
import { registerSettingsHandlers } from "./settings.ipc";
import { registerWorktreeHandlers } from "./worktrees.ipc";
import { registerSkillHandlers } from "./skills.ipc";
import { registerAutomationHandlers } from "./automations.ipc";

export function registerAllIPCHandlers(): void {
  registerProjectHandlers();
  registerAgentHandlers();
  registerSettingsHandlers();
  registerWorktreeHandlers();
  registerSkillHandlers();
  registerAutomationHandlers();
}
