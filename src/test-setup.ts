import "@testing-library/jest-dom";

// Mock window.matchMedia for jsdom
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock Tauri event plugin internals (used by @tauri-apps/api/event for unlisten)
Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
  writable: true,
  value: {
    unregisterListener: vi.fn(),
  },
});

// Mock Tauri internals for test environment
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  writable: true,
  value: {
    transformCallback: (callback?: (response: unknown) => void, once?: boolean) => {
      const id = Math.random();
      if (callback) {
        (window as unknown as Record<string, unknown>)[`_${id}`] = once
          ? (response: unknown) => { callback(response); delete (window as unknown as Record<string, unknown>)[`_${id}`]; }
          : callback;
      }
      return id;
    },
    invoke: vi.fn().mockImplementation((cmd: string) => {
      // Return sensible defaults for common commands
      if (cmd.endsWith("_list") || cmd.endsWith("_get_running") || cmd.endsWith("_get_history") || cmd.endsWith("_get_inbox") || cmd.endsWith("_get_templates")) return Promise.resolve([]);
      if (cmd === "settings_get") return Promise.resolve({});
      if (cmd === "status_get_info") return Promise.resolve({ version: "0.0.0", agents: 0, threads: 0 });
      if (cmd === "settings_get_cli_status") return Promise.resolve({ installed: false });
      if (cmd === "plugin:event|listen") return Promise.resolve(0);
      if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
      return Promise.resolve(null);
    }),
    metadata: { currentWebview: { label: "main" }, currentWindow: { label: "main" } },
    convertFileSrc: (path: string) => path,
  },
});
