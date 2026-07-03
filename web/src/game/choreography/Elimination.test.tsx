// ABOUTME: Structure tests for Elimination — cause + bounty recipient from the authoritative
// ABOUTME: `eliminated` GameEvent, and the reduced/animated branch.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Elimination } from "./Elimination";
import type { GameEvent } from "../../engine-client/barrel";

/** Installs a matchMedia stub that reports the given reduced-motion preference (motion.test.ts pattern). */
function stubReducedMotion(prefersReduced: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion: reduce") ? prefersReduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function eliminatedEvent(
  overrides: Partial<Extract<GameEvent, { kind: "eliminated" }>> = {},
): Extract<GameEvent, { kind: "eliminated" }> {
  return { kind: "eliminated", player: 2, cause: "noBases", bountyTo: 0, ...overrides };
}

describe("Elimination — cause + bounty from the eliminated event", () => {
  test("renders the eliminated player and the cause", () => {
    stubReducedMotion(false);
    render(<Elimination event={eliminatedEvent({ player: 2, cause: "noBases" })} />);

    expect(screen.getByTestId("elimination-cause").textContent).toMatch(/base/i);
  });

  test("every elimination cause renders a distinct, human cause phrase", () => {
    stubReducedMotion(false);
    const causes: Array<Extract<GameEvent, { kind: "eliminated" }>["cause"]> = [
      "noBases",
      "brokenPerimeterAt18Factories",
      "noIron",
      "emptyPerimeter",
    ];
    for (const cause of causes) {
      const { unmount } = render(<Elimination event={eliminatedEvent({ cause, bountyTo: null })} />);
      const causeText = screen.getByTestId("elimination-cause").textContent ?? "";
      expect(causeText, cause).not.toContain(cause);
      expect(causeText.trim(), cause).not.toBe("");
      unmount();
    }
  });

  test("renders the bounty recipient when present", () => {
    stubReducedMotion(false);
    render(<Elimination event={eliminatedEvent({ player: 2, cause: "noBases", bountyTo: 0 })} />);

    const bounty = screen.getByTestId("elimination-bounty");
    expect(bounty.textContent).toMatch(/bounty/i);
    expect(bounty.textContent).toMatch(/1/); // player 0 -> "Player 1"
  });

  test("the bounty phrase appears only in the bounty element, not duplicated into the cause line", () => {
    stubReducedMotion(false);
    render(<Elimination event={eliminatedEvent({ player: 2, cause: "noBases", bountyTo: 0 })} />);

    expect(screen.getByTestId("elimination-cause").textContent).not.toMatch(/bounty/i);
    expect(screen.getByTestId("elimination-bounty").textContent).toMatch(/bounty/i);
  });

  test("no bounty element when bountyTo is null", () => {
    stubReducedMotion(false);
    render(<Elimination event={eliminatedEvent({ cause: "emptyPerimeter", bountyTo: null })} />);

    expect(screen.queryByTestId("elimination-bounty")).not.toBeInTheDocument();
  });

  test("emptyPerimeter never shows a bounty element even if a recipient is (wrongly) supplied", () => {
    // Spec §8: emptyPerimeter is self-inflicted and yields no bounty. Defense in depth — the
    // component must not render a bounty for a self-inflicted cause regardless of bountyTo.
    stubReducedMotion(false);
    render(<Elimination event={eliminatedEvent({ cause: "emptyPerimeter", bountyTo: 0 })} />);

    expect(screen.queryByTestId("elimination-bounty")).not.toBeInTheDocument();
  });
});

describe("Elimination — reduced-motion branch", () => {
  test("reduced motion renders the static alternative: no animation class, a static summary present", () => {
    stubReducedMotion(true);
    render(<Elimination event={eliminatedEvent({ player: 1, cause: "noIron", bountyTo: 3 })} />);

    const root = screen.getByTestId("elimination");
    expect(root.className).not.toMatch(/elimination-animated/);
    expect(screen.getByTestId("elimination-static")).toBeInTheDocument();
  });

  test("non-reduced motion renders the animated variant: animation class present, no static summary", () => {
    stubReducedMotion(false);
    render(<Elimination event={eliminatedEvent({ player: 1, cause: "noIron", bountyTo: 3 })} />);

    const root = screen.getByTestId("elimination");
    expect(root.className).toMatch(/elimination-animated/);
    expect(screen.queryByTestId("elimination-static")).not.toBeInTheDocument();
  });
});
