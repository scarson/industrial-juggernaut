// ABOUTME: Structure tests for CombatReveal — the committed count + attackerWon outcome from the
// ABOUTME: authoritative `combat` GameEvent, honest mono numbers, and the reduced/animated branch.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CombatReveal } from "./CombatReveal";
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

const hex = { x: 0, y: 0, z: 0 };

function combatEvent(overrides: Partial<Extract<GameEvent, { kind: "combat" }>> = {}): Extract<
  GameEvent,
  { kind: "combat" }
> {
  return { kind: "combat", target: hex, committed: 5, attackerWon: true, ...overrides };
}

describe("CombatReveal — renders the real committed count + outcome", () => {
  test("a win shows the committed count and reads as a win, in mono", () => {
    stubReducedMotion(false);
    render(<CombatReveal event={combatEvent({ committed: 5, attackerWon: true })} />);

    const committed = screen.getByTestId("combat-reveal-committed");
    expect(committed.textContent).toMatch(/5/);
    expect(committed.className).toMatch(/\bmono\b/);
    expect(screen.getByTestId("combat-reveal-outcome").textContent).toMatch(/win|won|captures/i);
  });

  test("a loss shows the committed count and reads as a loss, in mono", () => {
    stubReducedMotion(false);
    render(<CombatReveal event={combatEvent({ committed: 3, attackerWon: false })} />);

    const committed = screen.getByTestId("combat-reveal-committed");
    expect(committed.textContent).toMatch(/3/);
    expect(committed.className).toMatch(/\bmono\b/);
    expect(screen.getByTestId("combat-reveal-outcome").textContent).toMatch(/loses|lost|holds|repelled/i);
  });

  test("every legal commitment level (3..6) is stated honestly", () => {
    stubReducedMotion(false);
    for (const committed of [3, 4, 5, 6]) {
      const { unmount } = render(<CombatReveal event={combatEvent({ committed })} />);
      expect(screen.getByTestId("combat-reveal-committed").textContent).toMatch(
        new RegExp(String(committed)),
      );
      unmount();
    }
  });
});

describe("CombatReveal — reduced-motion branch", () => {
  test("reduced motion renders the static alternative: no animation class, a static summary present", () => {
    stubReducedMotion(true);
    render(<CombatReveal event={combatEvent({ committed: 4, attackerWon: true })} />);

    const root = screen.getByTestId("combat-reveal");
    expect(root.className).not.toMatch(/combat-reveal-animated/);
    expect(screen.getByTestId("combat-reveal-static")).toBeInTheDocument();
    // The honest numbers stay visible even in the static branch.
    expect(screen.getByTestId("combat-reveal-committed").textContent).toMatch(/4/);
  });

  test("non-reduced motion renders the animated variant: animation class present, no static summary", () => {
    stubReducedMotion(false);
    render(<CombatReveal event={combatEvent({ committed: 4, attackerWon: true })} />);

    const root = screen.getByTestId("combat-reveal");
    expect(root.className).toMatch(/combat-reveal-animated/);
    expect(screen.queryByTestId("combat-reveal-static")).not.toBeInTheDocument();
  });
});
