// ABOUTME: Structure tests for Victory — coalition-aware rendering of the authoritative `victory`
// ABOUTME: GameEvent's `players` (plural = coalition victory), shape-tagged winners, reduced/animated branch.
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Victory } from "./Victory";

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

describe("Victory — solo winner", () => {
  test("renders the single winner, shape-tagged", () => {
    stubReducedMotion(false);
    render(<Victory winners={[3]} />);

    const winners = screen.getAllByTestId(/^victory-winner-/);
    expect(winners.length).toBe(1);
    const winner = screen.getByTestId("victory-winner-3");
    expect(winner.querySelector("svg")).not.toBeNull();
  });
});

describe("Victory — coalition (plural winners)", () => {
  test("renders every winner in a coalition, each shape-tagged", () => {
    stubReducedMotion(false);
    render(<Victory winners={[0, 2, 4]} />);

    const winners = screen.getAllByTestId(/^victory-winner-/);
    expect(winners.length).toBe(3);
    for (const seat of [0, 2, 4]) {
      const winner = screen.getByTestId(`victory-winner-${seat}`);
      expect(winner.querySelector("svg")).not.toBeNull();
    }
  });

  test("a coalition is labeled as shared victory, not a single winner", () => {
    stubReducedMotion(false);
    render(<Victory winners={[0, 2]} />);

    expect(screen.getByTestId("victory-title").textContent).toMatch(/coalition|share|shared/i);
  });
});

describe("Victory — reduced-motion branch", () => {
  test("reduced motion renders the static alternative: no animation class, a static summary present", () => {
    stubReducedMotion(true);
    render(<Victory winners={[1]} />);

    const root = screen.getByTestId("victory");
    expect(root.className).not.toMatch(/victory-animated/);
    expect(screen.getByTestId("victory-static")).toBeInTheDocument();
  });

  test("non-reduced motion renders the animated variant: animation class present, no static summary", () => {
    stubReducedMotion(false);
    render(<Victory winners={[1]} />);

    const root = screen.getByTestId("victory");
    expect(root.className).toMatch(/victory-animated/);
    expect(screen.queryByTestId("victory-static")).not.toBeInTheDocument();
  });
});
