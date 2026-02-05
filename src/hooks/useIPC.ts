import { useEffect, useCallback, useState } from "react";
import { ipc } from "@/lib/ipc-client";
import type {
  IPCInvokeChannel,
  IPCInvokeChannels,
  IPCEventChannel,
  IPCEventChannels,
} from "@/types/ipc";

/**
 * Hook for invoking IPC calls with loading/error state.
 */
export function useIPCInvoke<C extends IPCInvokeChannel>(
  channel: C
): {
  invoke: (
    ...args: IPCInvokeChannels[C]["args"]
  ) => Promise<IPCInvokeChannels[C]["return"]>;
  loading: boolean;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = useCallback(
    async (
      ...args: IPCInvokeChannels[C]["args"]
    ): Promise<IPCInvokeChannels[C]["return"]> => {
      setLoading(true);
      setError(null);
      try {
        const result = await ipc.invoke(channel, ...args);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown IPC error";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [channel]
  );

  return { invoke, loading, error };
}

/**
 * Hook for listening to IPC events from main process.
 * Automatically cleans up listener on unmount.
 */
export function useIPCEvent<C extends IPCEventChannel>(
  channel: C,
  handler: (...args: IPCEventChannels[C]) => void
): void {
  useEffect(() => {
    ipc.on(channel, handler);
    return () => {
      ipc.off(channel, handler);
    };
  }, [channel, handler]);
}
