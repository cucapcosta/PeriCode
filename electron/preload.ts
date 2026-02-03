import { contextBridge, ipcRenderer } from "electron";

// Valid IPC channels - must match IPCInvokeChannels and IPCEventChannels
const VALID_INVOKE_CHANNELS = new Set([
  "project:list",
  "project:add",
  "project:remove",
  "project:getSettings",
  "project:updateSettings",
  "agent:launch",
  "agent:pause",
  "agent:resume",
  "agent:cancel",
  "agent:sendMessage",
  "agent:getRunning",
  "thread:list",
  "thread:get",
  "thread:getMessages",
  "thread:delete",
  "thread:fork",
  "worktree:getDiff",
  "worktree:acceptAll",
  "worktree:acceptFile",
  "worktree:reject",
  "worktree:openInEditor",
  "skill:list",
  "skill:get",
  "skill:create",
  "skill:update",
  "skill:delete",
  "skill:export",
  "skill:import",
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
  "settings:get",
  "settings:update",
  "settings:getApiKeyStatus",
]);

const VALID_EVENT_CHANNELS = new Set([
  "agent:message",
  "agent:status",
  "agent:error",
  "agent:cost",
  "automation:completed",
  "notification",
]);

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
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  once: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (!VALID_EVENT_CHANNELS.has(channel)) {
      console.warn(`Invalid IPC event channel: ${channel}`);
      return;
    }
    ipcRenderer.once(channel, (_event, ...args) => callback(...args));
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
