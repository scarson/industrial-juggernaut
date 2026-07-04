// ABOUTME: Structure tests for the App shell — header + Instruments button always present,
// ABOUTME: the rail collapses per breakpoint, and the router renders the routed screen.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { App } from "./App";
import { useSetRailContent } from "./shell/rail-content";
import type { ComponentType, ReactNode } from "react";

// The Router seat: every test gets the real Router by default; the render-scoping test swaps in a
// probe screen so it can count routed-screen renders and publish rail content from inside the tree
// (the same position a real screen publishes from). Assertions stay on the real App composition.
const routerSeat = vi.hoisted(() => ({ Probe: null as ComponentType | null }));

vi.mock("./routes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routes")>();
  function RouterSeat() {
    const Probe = routerSeat.Probe;
    return Probe !== null ? <Probe /> : <actual.Router />;
  }
  return { ...actual, Router: RouterSeat };
});

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
  routerSeat.Probe = null;
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

  test("the shell rail renders on /game too, showing the placeholder before a game starts", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/game");
    render(<App />);
    // The shell rail is present on every route; before a game starts (the NewGame designer) it shows
    // the placeholder, consistent with the other routes.
    expect(screen.getByRole("complementary", { name: "Rail" })).toBeInTheDocument();
    expect(screen.getByText(/per-player resources/i)).toBeInTheDocument();
  });

  test("the shell rail shows the placeholder on a non-game route", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.getByRole("complementary", { name: "Rail" })).toBeInTheDocument();
    expect(screen.getByText(/per-player resources/i)).toBeInTheDocument();
  });

  test("publishing rail content does not re-render the routed screen", () => {
    stubMatchMediaForWidth(1200);
    const screenRenders = vi.fn();
    let publish: ((node: ReactNode) => void) | null = null;
    routerSeat.Probe = function ProbeScreen() {
      screenRenders();
      publish = useSetRailContent();
      return <p>probe screen</p>;
    };

    render(<App />);
    expect(screenRenders).toHaveBeenCalledTimes(1);

    act(() => publish!(<span>published instruments</span>));

    // The publish landed: the rail shows the content and the placeholder is gone...
    expect(screen.getByText("published instruments")).toBeInTheDocument();
    expect(screen.queryByText(/per-player resources/i)).not.toBeInTheDocument();
    // ...and the routed screen never re-rendered — rail-content state lives inside the provider,
    // and App neither holds nor subscribes to it.
    expect(screenRenders).toHaveBeenCalledTimes(1);
  });
});
