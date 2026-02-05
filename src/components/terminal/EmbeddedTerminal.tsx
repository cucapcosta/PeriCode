import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { ipc } from "@/lib/ipc-client";
import "@xterm/xterm/css/xterm.css";

interface EmbeddedTerminalProps {
  id: string;
  cwd: string;
  onClose?: () => void;
}

export const EmbeddedTerminal: React.FC<EmbeddedTerminalProps> = ({
  id,
  cwd,
  onClose,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
      theme: {
        background: "#151b2b",
        foreground: "#d6dce8",
        cursor: "#a0aec0",
        selectionBackground: "#264f78",
        selectionForeground: "#ffffff",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    // Fit to container
    try {
      fitAddon.fit();
    } catch {
      // May fail if container is not yet visible
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Create the terminal session in main process
    ipc.invoke("terminal:create", id, cwd).then(() => {
      setConnected(true);
    }).catch((err) => {
      term.writeln(`\x1b[31mFailed to create terminal: ${err}\x1b[0m`);
    });

    // Forward user input to main process
    term.onData((data) => {
      ipc.invoke("terminal:write", id, data).catch(() => {
        // Terminal may have been destroyed
      });
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ipc.invoke("terminal:resize", id, dims.cols, dims.rows).catch(() => {});
        }
      } catch {
        // Ignore resize errors
      }
    });
    resizeObserver.observe(terminalRef.current);

    // Receive data from main process
    const dataHandler = (...args: unknown[]) => {
      const termId = args[0] as string;
      const data = args[1] as string;
      if (termId === id) {
        term.write(data);
      }
    };

    const exitHandler = (...args: unknown[]) => {
      const termId = args[0] as string;
      if (termId === id) {
        setConnected(false);
      }
    };

    ipc.on("terminal:data", dataHandler);
    ipc.on("terminal:exit", exitHandler);

    return () => {
      resizeObserver.disconnect();
      ipc.off("terminal:data", dataHandler);
      ipc.off("terminal:exit", exitHandler);
      term.dispose();
      ipc.invoke("terminal:destroy", id).catch(() => {});
    };
  }, [id, cwd]);

  return (
    <div className="flex flex-col h-full bg-[#151b2b]">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a2138] border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            {connected ? ">" : "x"} Terminal
          </span>
          <span className="text-[10px] text-muted-foreground/60 truncate max-w-[200px]">
            {cwd}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!connected && (
            <button
              onClick={() => {
                ipc.invoke("terminal:create", id, cwd).then(() => {
                  setConnected(true);
                  xtermRef.current?.clear();
                }).catch(() => {});
              }}
              className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Restart
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Terminal area */}
      <div ref={terminalRef} className="flex-1 p-1" />
    </div>
  );
};
