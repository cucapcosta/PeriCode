import type {
  IPCInvokeChannels,
  IPCInvokeChannel,
  IPCEventChannels,
  IPCEventChannel,
} from "@/types/ipc";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Maps each IPC channel to its positional argument names.
 * Derived from IPCInvokeChannels in types/ipc.ts.
 */
const CHANNEL_ARG_NAMES: Record<string, string[]> = {
  // Projects
  "project:list": [],
  "project:add": ["path"],
  "project:remove": ["id"],
  "project:getSettings": ["id"],
  "project:updateSettings": ["id", "settings"],
  "project:openFolder": [],
  "project:detectInfo": ["projectId"],
  // Agents
  "agent:launch": ["config"],
  "agent:pause": ["threadId"],
  "agent:resume": ["threadId"],
  "agent:cancel": ["threadId"],
  "agent:sendMessage": ["threadId", "message", "imagePaths"],
  "agent:respondPermission": ["response"],
  "agent:getRunning": [],
  // Threads
  "thread:list": ["projectId"],
  "thread:get": ["threadId"],
  "thread:getMessages": ["threadId"],
  "thread:delete": ["threadId"],
  "thread:fork": ["threadId"],
  "thread:getCostSummary": ["threadId"],
  "thread:updateProvider": ["threadId", "provider", "model"],
  // Notes
  "notes:get": ["threadId"],
  "notes:save": ["threadId", "content"],
  "notes:delete": ["threadId"],
  // Worktrees
  "worktree:getDiff": ["threadId"],
  "worktree:acceptAll": ["threadId"],
  "worktree:acceptFile": ["threadId", "filePath"],
  "worktree:reject": ["threadId"],
  "worktree:openInEditor": ["threadId", "filePath"],
  "worktree:openInVSCode": ["filePath", "lineOrProjectPath", "line"],
  // Git
  "git:getCurrentBranch": ["projectId"],
  "git:getDiffStats": ["projectId"],
  "git:status": ["projectId"],
  "git:add": ["projectId", "files"],
  "git:commit": ["projectId", "message"],
  "git:push": ["projectId", "remote", "branch"],
  "git:pull": ["projectId", "remote", "branch"],
  "git:checkout": ["projectId", "branchOrPath", "createNew"],
  "git:branch": ["projectId", "action", "branchName"],
  // Skills
  "skill:list": [],
  "skill:get": ["id"],
  "skill:create": ["definition"],
  "skill:update": ["id", "definition"],
  "skill:delete": ["id"],
  "skill:export": ["id"],
  "skill:import": ["archivePath"],
  "skill:importFromGit": ["gitUrl"],
  // Automations
  "automation:list": ["projectId"],
  "automation:create": ["config"],
  "automation:update": ["id", "config"],
  "automation:delete": ["id"],
  "automation:trigger": ["id"],
  "automation:toggleEnabled": ["id"],
  "automation:getHistory": ["id"],
  "automation:getInbox": ["filters"],
  "automation:markRead": ["runId"],
  "automation:archiveRun": ["runId"],
  "automation:getTemplates": [],
  // Settings
  "settings:get": [],
  "settings:update": ["settings"],
  "settings:getCliStatus": [],
  // Providers
  "provider:list": [],
  "provider:getModels": ["provider"],
  "copilot:startAuth": [],
  "copilot:pollAuth": ["deviceCode", "interval", "expiresIn"],
  "copilot:checkAuth": [],
  "copilot:logout": [],
  // Status
  "status:getInfo": [],
  "notification:getHistory": [],
  "notification:clear": [],
  // Terminal
  "terminal:create": ["id", "cwd"],
  "terminal:write": ["id", "data"],
  "terminal:resize": ["id", "cols", "rows"],
  "terminal:destroy": ["id"],
  "terminal:list": [],
  // Export
  "export:threadMarkdown": ["threadId"],
  "export:diffPatch": ["threadId"],
  "export:automationCsv": ["projectId"],
  "export:costReport": ["projectId"],
  // Images
  "image:pick": [],
  "image:readBase64": ["filePath"],
  "image:validatePath": ["filePath"],
  "image:saveFromClipboard": [],
  "image:saveFromBase64": ["dataUrl", "mimeType"],
  // Commands
  "command:openVSCode": ["projectPath"],
  "command:rebuild": ["projectPath"],
  "command:build": ["projectPath", "buildCommand"],
};

/**
 * Convert Electron-style channel name to Tauri command name.
 * "project:list" -> "project_list"
 * "agent:sendMessage" -> "agent_send_message"
 */
function channelToCommand(channel: string): string {
  return channel
    .replace(/:/g, "_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/**
 * Convert positional args to named args object for Tauri invoke.
 */
function positionalToNamed(channel: string, args: unknown[]): Record<string, unknown> {
  const names = CHANNEL_ARG_NAMES[channel] ?? [];
  const named: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    if (i < names.length && args[i] !== undefined) {
      named[names[i]] = args[i];
    }
  }
  return named;
}

// Track active listeners for cleanup
const activeListeners: Map<string, Map<Function, UnlistenFn>> = new Map();

/**
 * Type-safe IPC client for renderer process.
 * Uses Tauri invoke/listen instead of Electron IPC.
 */
export const ipc = {
  invoke: <C extends IPCInvokeChannel>(
    channel: C,
    ...args: IPCInvokeChannels[C]["args"]
  ): Promise<IPCInvokeChannels[C]["return"]> => {
    const command = channelToCommand(channel);
    const namedArgs = positionalToNamed(channel, args as unknown[]);
    return tauriInvoke(command, namedArgs);
  },

  on: <C extends IPCEventChannel>(
    channel: C,
    callback: (...args: IPCEventChannels[C]) => void
  ): void => {
    const wrappedCallback = (event: { payload: IPCEventChannels[C] }) => {
      const payload = Array.isArray(event.payload) ? event.payload : [event.payload];
      (callback as (...args: unknown[]) => void)(...payload);
    };

    listen(channel, wrappedCallback).then((unlisten) => {
      if (!activeListeners.has(channel)) {
        activeListeners.set(channel, new Map());
      }
      activeListeners.get(channel)!.set(callback, unlisten);
    });
  },

  once: <C extends IPCEventChannel>(
    channel: C,
    callback: (...args: IPCEventChannels[C]) => void
  ): void => {
    listen(channel, (event: { payload: IPCEventChannels[C] }) => {
      const payload = Array.isArray(event.payload) ? event.payload : [event.payload];
      (callback as (...args: unknown[]) => void)(...payload);
    }).then((unlisten) => {
      // Wrap to auto-unlisten after first call
      const originalCallback = callback;
      const channelListeners = activeListeners.get(channel);
      if (channelListeners) {
        channelListeners.set(originalCallback, unlisten);
      }
    });
  },

  off: <C extends IPCEventChannel>(
    channel: C,
    callback: (...args: IPCEventChannels[C]) => void
  ): void => {
    const channelListeners = activeListeners.get(channel);
    if (channelListeners) {
      const unlisten = channelListeners.get(callback);
      if (unlisten) {
        unlisten();
        channelListeners.delete(callback);
      }
    }
  },
};
