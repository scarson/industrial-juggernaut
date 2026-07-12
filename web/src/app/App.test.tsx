// ABOUTME: Structure tests for the App shell — header + Instruments button always present,
// ABOUTME: the rail collapses per breakpoint, and the router renders the routed screen.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { useEffect, type ComponentType, type ReactNode } from "react";
import { App } from "./App";
import { useSetRailContent } from "./shell/rail-content";
import { useSetShellLabels } from "./shell/shell-labels";

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
  test("renders a <header> with the wordmark; no Instruments button until the menu exists", () => {
    stubMatchMediaForWidth(1200);
    render(<App />);
    const banner = screen.getByRole("banner");
    // Scoped to the banner: the landing screen's title plate carries the same text in <main>.
    expect(within(banner).getByText("Industrial Juggernaut")).toBeInTheDocument();
    // The Instruments affordance recedes while unwired (the Brass Budget bans inactive brass);
    // it returns the moment the shell gives it a real job.
    expect(screen.queryByRole("button", { name: "Instruments" })).toBeNull();
  });

  test("the wordmark navigates home from another route", async () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/rules");
    render(<App />);
    await act(async () => {
      screen.getByRole("link", { name: "Industrial Juggernaut" }).click();
    });
    expect(window.location.pathname).toBe("/");
  });

  test("at wide (>=1100px), published rail content is present without a toggle", () => {
    stubMatchMediaForWidth(1200);
    routerSeat.Probe = function PublishingScreen() {
      const publish = useSetRailContent();
      useEffect(() => {
        publish(<span>instruments</span>);
        return () => publish(null);
      }, [publish]);
      return <p>probe screen</p>;
    };
    render(<App />);
    expect(screen.getByRole("complementary", { name: "Rail" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rail/i })).toBeNull();
  });

  test("at narrow (768-1099px), a publishing screen's rail collapses to a toggle", () => {
    stubMatchMediaForWidth(900);
    routerSeat.Probe = function PublishingScreen() {
      const publish = useSetRailContent();
      useEffect(() => {
        publish(<span>instruments</span>);
        return () => publish(null);
      }, [publish]);
      return <p>probe screen</p>;
    };
    render(<App />);
    const toggle = screen.getByRole("button", { name: /rail/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("routes to the landing screen at /", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: /industrial juggernaut/i }),
    ).toBeInTheDocument();
  });

  test("routes to the rules screen at /rules", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/rules");
    render(<App />);
    expect(screen.getByRole("heading", { name: /rules/i })).toBeInTheDocument();
  });

  test("no rail on /game before a game starts — the designer publishes no instruments yet", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/game");
    render(<App />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  test("no rail on the landing — a rail with nothing to hold earns no pixels", () => {
    stubMatchMediaForWidth(1200);
    window.history.pushState({}, "", "/");
    render(<App />);
    expect(screen.queryByRole("complementary")).toBeNull();
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
    // Nothing published yet: no rail landmark at all.
    expect(screen.queryByRole("complementary")).toBeNull();

    act(() => publish!(<span>published instruments</span>));

    // The publish landed: the rail mounted around the content...
    const rail = screen.getByRole("complementary", { name: "Rail" });
    expect(rail).toContainElement(screen.getByText("published instruments"));
    // ...and the routed screen never re-rendered — rail-content state lives inside the provider,
    // and App neither holds nor subscribes to it.
    expect(screenRenders).toHaveBeenCalledTimes(1);
  });
});

describe("App — shell labels seam", () => {
  test("publishing shell labels surfaces the top-bar turn chip + seed readout without re-rendering the routed screen", () => {
    stubMatchMediaForWidth(1200);
    const screenRenders = vi.fn();
    let publish: ((labels: { turnLabel: string; seedLabel: string } | null) => void) | null = null;
    routerSeat.Probe = function ProbeScreen() {
      screenRenders();
      publish = useSetShellLabels();
      return <p>probe screen</p>;
    };

    render(<App />);
    expect(screenRenders).toHaveBeenCalledTimes(1);
    // Nothing published: the chip and readout recede entirely.
    expect(screen.queryByTestId("topbar-turn")).toBeNull();
    expect(screen.queryByTestId("topbar-seed")).toBeNull();

    act(() => publish!({ turnLabel: "Turn 3 — Player 2's round", seedLabel: "seed 42 · 96 hexes" }));

    expect(screen.getByTestId("topbar-turn")).toHaveTextContent("Turn 3 — Player 2's round");
    expect(screen.getByTestId("topbar-seed")).toHaveTextContent("seed 42 · 96 hexes");
    // The routed screen never re-rendered — labels live inside the provider, not App.
    expect(screenRenders).toHaveBeenCalledTimes(1);

    act(() => publish!(null));
    expect(screen.queryByTestId("topbar-turn")).toBeNull();
    expect(screen.queryByTestId("topbar-seed")).toBeNull();
  });
});
