import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renders the app title", () => {
    render(<App />);
    expect(screen.getByText("PeriCode")).toBeInTheDocument();
  });

  it("renders the welcome message when no thread is active", () => {
    render(<App />);
    expect(screen.getByText("Welcome to PeriCode")).toBeInTheDocument();
  });

  it("renders the no projects message", () => {
    render(<App />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });
});
