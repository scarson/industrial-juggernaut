// ABOUTME: Structure tests for the App shell — header + Instruments button always present,
// ABOUTME: the rail collapses per breakpoint, and the router renders the routed screen.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

/** Installs a matchMedia stub reporting tiers for the given viewport width. */
function stubMatchMediaForWidth(width: number): void {
  vi.stubGlobal("matchMedia", (query: string) => {
    const minWidthMatch = query.match(/min-width:\s*(\d+)px/);
    const matches = minWidthMatch !== null && width >= Number(minWidthMatch[1]);
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("App", () => {
  test("renders a <header> with the wordmark and an Instruments button", () => {
    stubMatchMediaForWidth(1200);
    render(<App />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByText("Industrial Juggernaut")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Instruments" })).toBeInTheDocument();
  });

  test("at wide (>=1100px), the rail's content is present without a toggle", () => {
    stubMatchMediaForWidth(1200);
    render(<App />);
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rail/i })).toBeNull();
  });

  test("at narrow (768-1099px), the rail collapses to a toggle with aria-expanded=false", () => {
    stubMatchMediaForWidth(900);
    render(<App />);
    const toggle = screen.getByRole("button", { name: /rail/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("routes to the home screen at /", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByRole("heading", { name: /home/i })).toBeInTheDocument();
  });

  test("routes to the rules screen at /rules", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/rules");
    render(<App />);
    expect(screen.getByRole("heading", { name: /rules/i })).toBeInTheDocument();
  });

  test("suppresses the shell's placeholder rail on /game (the game screen owns its own rail)", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/game");
    render(<App />);
    // The shell's "Rail"-labelled aside must not render on /game; only GameScreen's own layout shows.
    expect(screen.queryByRole("complementary", { name: /rail/i })).toBeNull();
  });
});
