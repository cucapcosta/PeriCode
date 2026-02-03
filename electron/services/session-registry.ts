import { logger } from "../utils/logger";

interface SessionEntry {
  threadId: string;
  sessionId: string;
  createdAt: string;
}

/**
 * Maps PeriCode thread IDs to Claude Agent SDK session IDs.
 * Enables resume and fork operations across app restarts.
 */
class SessionRegistry {
  private sessions: Map<string, SessionEntry> = new Map();

  register(threadId: string, sessionId: string): void {
    this.sessions.set(threadId, {
      threadId,
      sessionId,
      createdAt: new Date().toISOString(),
    });
    logger.debug("session-registry", `Registered session ${sessionId} for thread ${threadId}`);
  }

  getSessionId(threadId: string): string | null {
    return this.sessions.get(threadId)?.sessionId ?? null;
  }

  getThreadId(sessionId: string): string | null {
    for (const entry of this.sessions.values()) {
      if (entry.sessionId === sessionId) {
        return entry.threadId;
      }
    }
    return null;
  }

  remove(threadId: string): void {
    this.sessions.delete(threadId);
  }

  hasSession(threadId: string): boolean {
    return this.sessions.has(threadId);
  }

  getAllSessions(): SessionEntry[] {
    return Array.from(this.sessions.values());
  }

  clear(): void {
    this.sessions.clear();
  }
}

export const sessionRegistry = new SessionRegistry();
