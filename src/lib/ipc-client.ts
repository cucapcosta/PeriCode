export const ipc = {
  invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
    return window.electronAPI.invoke<T>(channel, ...args);
  },
  on: (channel: string, callback: (...args: unknown[]) => void): void => {
    window.electronAPI.on(channel, callback);
  },
  off: (channel: string): void => {
    window.electronAPI.removeAllListeners(channel);
  },
};
