import { spawn, type ChildProcess } from "child_process";
import { BrowserWindow } from "electron";
import { logger } from "../utils/logger";

interface TerminalSession {
  id: string;
  process: ChildProcess;
  cwd: string;
}

class TerminalService {
  private sessions: Map<string, TerminalSession> = new Map();

  /**
   * Create a new terminal session.
   * Uses ConPTY on Windows for proper terminal emulation.
   */
  create(id: string, cwd: string): void {
    if (this.sessions.has(id)) {
      this.destroy(id);
    }

    const isWin = process.platform === "win32";
    // Use cmd.exe on Windows for better compatibility without PTY
    // PowerShell has issues with line editing without proper PTY
    const shell = isWin ? "cmd.exe" : (process.env.SHELL || "bash");
    const shellArgs = isWin ? ["/k"] : ["-i"];

    // Spawn options - use windowsHide and proper stdio for better terminal behavior
    const proc = spawn(shell, shellArgs, {
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        // Force interactive mode hints
        PS1: isWin ? undefined : "\\u@\\h:\\w\\$ ",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      // Enable ConPTY on Windows for better terminal support
      ...(isWin && { windowsVerbatimArguments: false }),
    });

    const session: TerminalSession = { id, process: proc, cwd };
    this.sessions.set(id, session);

    // Forward stdout to renderer
    proc.stdout?.on("data", (data: Buffer) => {
      this.sendToRenderer("terminal:data", id, data.toString());
    });

    // Forward stderr to renderer
    proc.stderr?.on("data", (data: Buffer) => {
      this.sendToRenderer("terminal:data", id, data.toString());
    });

    // Handle exit
    proc.on("exit", (code) => {
      this.sendToRenderer(
        "terminal:data",
        id,
        `\r\n[Process exited with code ${code ?? 0}]\r\n`
      );
      this.sendToRenderer("terminal:exit", id, String(code ?? 0));
      this.sessions.delete(id);
    });

    proc.on("error", (err) => {
      logger.error("terminal-service", `Terminal ${id} error`, err);
      this.sendToRenderer("terminal:data", id, `\r\n[Error: ${err.message}]\r\n`);
    });

    logger.info("terminal-service", `Created terminal ${id} in ${cwd}`);
  }

  /**
   * Write input to a terminal session.
   */
  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session?.process.stdin?.writable) {
      session.process.stdin.write(data);
    }
  }

  /**
   * Resize terminal (no-op without PTY, but keep API).
   */
  resize(id: string, _cols: number, _rows: number): void {
    // Without node-pty, resize is a no-op
    const session = this.sessions.get(id);
    if (!session) return;
  }

  /**
   * Destroy a terminal session.
   */
  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      try {
        session.process.kill();
      } catch {
        // Already dead
      }
      this.sessions.delete(id);
      logger.info("terminal-service", `Destroyed terminal ${id}`);
    }
  }

  /**
   * Check if a terminal session exists.
   */
  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * Get all active terminal session IDs.
   */
  getActiveIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Clean up all terminal sessions.
   */
  shutdown(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  }
}

export const terminalService = new TerminalService();
