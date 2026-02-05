import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

// Mock the electronAPI for tests
beforeEach(() => {
  window.electronAPI = {
    invoke: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  };
});

describe("App", () => {
  it("renders the app title", () => {
    render(<App />);
    expect(screen.getByText("PeriCode")).toBeInTheDocument();
  });

  it("renders the welcome message when no thread is active", () => {
    render(<App />);
    expect(screen.getByText("Welcome to PeriCode")).toBeInTheDocument();
  });

  it("renders the sidebar subtitle", () => {
    render(<App />);
    expect(
      screen.getByText("Multi-agent command center")
    ).toBeInTheDocument();
  });
});
