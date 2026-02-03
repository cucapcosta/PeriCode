import type {
  IPCInvokeChannels,
  IPCInvokeChannel,
  IPCEventChannels,
  IPCEventChannel,
} from "@/types/ipc";

/**
 * Type-safe IPC client for renderer process.
 * Provides compile-time checking of channel names and argument types.
 */
export const ipc = {
  /**
   * Invoke an IPC handler in the main process and await the result.
   */
  invoke: <C extends IPCInvokeChannel>(
    channel: C,
    ...args: IPCInvokeChannels[C]["args"]
  ): Promise<IPCInvokeChannels[C]["return"]> => {
    return window.electronAPI.invoke(channel, ...args);
  },

  /**
   * Listen for events from the main process.
   */
  on: <C extends IPCEventChannel>(
    channel: C,
    callback: (...args: IPCEventChannels[C]) => void
  ): void => {
    window.electronAPI.on(
      channel,
      callback as (...args: unknown[]) => void
    );
  },

  /**
   * Listen for a single event from the main process.
   */
  once: <C extends IPCEventChannel>(
    channel: C,
    callback: (...args: IPCEventChannels[C]) => void
  ): void => {
    window.electronAPI.once(
      channel,
      callback as (...args: unknown[]) => void
    );
  },

  /**
   * Remove all listeners for an event channel.
   */
  off: (channel: IPCEventChannel): void => {
    window.electronAPI.removeAllListeners(channel);
  },
};
