import { registerProjectHandlers } from "./projects.ipc";
import { registerAgentHandlers } from "./agents.ipc";
import { registerSettingsHandlers } from "./settings.ipc";

export function registerAllIPCHandlers(): void {
  registerProjectHandlers();
  registerAgentHandlers();
  registerSettingsHandlers();
}
