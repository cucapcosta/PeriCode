import { contextBridge, ipcRenderer } from "electron";

// Valid IPC channels - must match IPCInvokeChannels and IPCEventChannels
const VALID_INVOKE_CHANNELS = new Set([
  "project:list",
  "project:add",
  "project:remove",
  "project:getSettings",
  "project:updateSettings",
  "project:openFolder",
  "project:detectInfo",
  "agent:launch",
  "agent:pause",
  "agent:resume",
  "agent:cancel",
  "agent:sendMessage",
  "agent:respondPermission",
  "agent:getRunning",
  "thread:list",
  "thread:get",
  "thread:getMessages",
  "thread:delete",
  "thread:fork",
  "thread:getCostSummary",
  "thread:updateProvider",
  "worktree:getDiff",
  "worktree:acceptAll",
  "worktree:acceptFile",
  "worktree:reject",
  "worktree:openInEditor",
  "worktree:openInVSCode",
  "skill:list",
  "skill:get",
  "skill:create",
  "skill:update",
  "skill:delete",
  "skill:export",
  "skill:import",
  "skill:importFromGit",
  "automation:list",
  "automation:create",
  "automation:update",
  "automation:delete",
  "automation:trigger",
  "automation:toggleEnabled",
  "automation:getHistory",
  "automation:getInbox",
  "automation:markRead",
  "automation:archiveRun",
  "automation:getTemplates",
  "settings:get",
  "settings:update",
  "settings:getCliStatus",
  "status:getInfo",
  "notification:getHistory",
  "notification:clear",
  "terminal:create",
  "terminal:write",
  "terminal:resize",
  "terminal:destroy",
  "terminal:list",
  "export:threadMarkdown",
  "export:diffPatch",
  "export:automationCsv",
  "export:costReport",
  "notes:get",
  "notes:save",
  "notes:delete",
  "image:pick",
  "image:readBase64",
  "image:validatePath",
  "image:saveFromClipboard",
  "image:saveFromBase64",
  "command:openVSCode",
  "command:rebuild",
  "command:build",
  "git:getCurrentBranch",
  "git:getDiffStats",
  "git:status",
  "git:add",
  "git:commit",
  "git:push",
  "git:pull",
  "git:checkout",
  "git:branch",
  "git:publish",
  // Providers
  "provider:list",
  "provider:getModels",
  // Copilot Auth
  "copilot:startAuth",
  "copilot:pollAuth",
  "copilot:checkAuth",
  "copilot:logout",
]);

const VALID_EVENT_CHANNELS = new Set([
  "agent:message",
  "agent:status",
  "agent:error",
  "agent:cost",
  "automation:completed",
  "notification",
  "terminal:data",
  "terminal:exit",
]);

// Map renderer callbacks to the ipcRenderer wrapper functions,
// so we can remove a specific listener without nuking all of them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listenerMap = new WeakMap<(...args: unknown[]) => void, (...args: any[]) => void>();

const electronAPI = {
  invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
    if (!VALID_INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Invalid IPC invoke channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!VALID_EVENT_CHANNELS.has(channel)) {
      console.warn(`Invalid IPC event channel: ${channel}`);
      return;
    }
    const wrapper = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    listenerMap.set(callback, wrapper);
    ipcRenderer.on(channel, wrapper);
  },
  once: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!VALID_EVENT_CHANNELS.has(channel)) {
      console.warn(`Invalid IPC event channel: ${channel}`);
      return;
    }
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
  },
  removeListener: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!VALID_EVENT_CHANNELS.has(channel)) {
      return;
    }
    const wrapper = listenerMap.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper);
      listenerMap.delete(callback);
    }
  },
  removeAllListeners: (channel: string): void => {
    if (!VALID_EVENT_CHANNELS.has(channel)) {
      return;
    }
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
