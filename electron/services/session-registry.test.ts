import { describe, it, expect, beforeEach } from "vitest";
import { sessionRegistry } from "./session-registry";

beforeEach(() => {
  sessionRegistry.clear();
});

describe("session-registry", () => {
  it("registers and retrieves a session", () => {
    sessionRegistry.register("thread-1", "session-abc");
    expect(sessionRegistry.getSessionId("thread-1")).toBe("session-abc");
  });

  it("returns null for unknown thread", () => {
    expect(sessionRegistry.getSessionId("nonexistent")).toBeNull();
  });

  it("finds thread by session ID", () => {
    sessionRegistry.register("thread-1", "session-abc");
    expect(sessionRegistry.getThreadId("session-abc")).toBe("thread-1");
  });

  it("returns null for unknown session ID", () => {
    expect(sessionRegistry.getThreadId("nonexistent")).toBeNull();
  });

  it("removes a session", () => {
    sessionRegistry.register("thread-1", "session-abc");
    sessionRegistry.remove("thread-1");
    expect(sessionRegistry.getSessionId("thread-1")).toBeNull();
  });

  it("checks if session exists", () => {
    expect(sessionRegistry.hasSession("thread-1")).toBe(false);
    sessionRegistry.register("thread-1", "session-abc");
    expect(sessionRegistry.hasSession("thread-1")).toBe(true);
  });

  it("lists all sessions", () => {
    sessionRegistry.register("thread-1", "session-1");
    sessionRegistry.register("thread-2", "session-2");
    const all = sessionRegistry.getAllSessions();
    expect(all).toHaveLength(2);
  });

  it("clears all sessions", () => {
    sessionRegistry.register("thread-1", "session-1");
    sessionRegistry.register("thread-2", "session-2");
    sessionRegistry.clear();
    expect(sessionRegistry.getAllSessions()).toHaveLength(0);
  });
});
