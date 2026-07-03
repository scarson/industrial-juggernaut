// ABOUTME: Structure tests for ResourcePanel — one shape-tagged mono row per non-eliminated
// ABOUTME: player, showing iron/factories/bases counts sourced from controlOf (never re-summed).
import { describe, expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ResourcePanel } from "./ResourcePanel";
import { hex } from "../../../src/geometry/cube";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";

function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 3,
    config: defaultConfig(),
  });
}

// A 3-player fixture with distinct, easily-asserted resource counts per player:
//   p0: 2 bases, iron under its radiating control, no factories placed under its control
//   p1: 1 base, 1 factory under its control, no iron under its control
//   p2: eliminated — must NOT render a row at all
const P0_A = hex(0, 0, 0);
const P0_B = hex(1, -1, 0);
const P0_IRON = hex(0, 1, -1); // distance 1 from P0_A — inside radiating control
const P1_BASE = hex(10, -5, -5);
const P1_FACTORY = hex(10, -4, -6); // distance 1 from P1_BASE — inside radiating control
const P2_BASE = hex(-10, 5, 5);

function resourceFixture(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map((h) => `${h.x},${h.y},${h.z}`));
  const extraHexes = [P0_A, P0_B, P0_IRON, P1_BASE, P1_FACTORY, P2_BASE].filter(
    (h) => !present.has(`${h.x},${h.y},${h.z}`),
  );
  return {
    ...base,
    board: { ...base.board, hexes: [...base.board.hexes, ...extraHexes], iron: [P0_IRON] },
    phase: { turn: 1, order: [0, 1, 2], indexInOrder: 0 },
    factories: [{ hex: P1_FACTORY }],
    bases: [
      { owner: 0, hex: P0_A, state: "fresh", order: 0 },
      { owner: 0, hex: P0_B, state: "fresh", order: 1 },
      { owner: 1, hex: P1_BASE, state: "fresh", order: 0 },
      { owner: 2, hex: P2_BASE, state: "fresh", order: 0 },
    ],
    players: [
      { id: 0, basesInHand: 10, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 11, alliance: [1], eliminated: false },
      { id: 2, basesInHand: 11, alliance: [2], eliminated: true },
    ],
  };
}

describe("ResourcePanel — per-player resource rows", () => {
  test("renders one row per non-eliminated player, none for eliminated players", () => {
    const state = resourceFixture();
    render(<ResourcePanel state={state} />);

    expect(screen.getByTestId("resource-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("resource-row-1")).toBeInTheDocument();
    expect(screen.queryByTestId("resource-row-2")).not.toBeInTheDocument();
  });

  test("each row shows iron/factories/bases counts sourced from controlOf, in mono", () => {
    const state = resourceFixture();
    render(<ResourcePanel state={state} />);

    const p0Row = screen.getByTestId("resource-row-0");
    expect(within(p0Row).getByTestId("resource-iron").textContent).toBe("1");
    expect(within(p0Row).getByTestId("resource-factories").textContent).toBe("0");
    expect(within(p0Row).getByTestId("resource-bases").textContent).toBe("2");
    expect(within(p0Row).getByTestId("resource-iron").className).toMatch(/\bmono\b/);

    const p1Row = screen.getByTestId("resource-row-1");
    expect(within(p1Row).getByTestId("resource-iron").textContent).toBe("0");
    expect(within(p1Row).getByTestId("resource-factories").textContent).toBe("1");
    expect(within(p1Row).getByTestId("resource-bases").textContent).toBe("1");
  });

  test("each row is shape-tagged with the player's identity", () => {
    const state = resourceFixture();
    render(<ResourcePanel state={state} />);

    const p0Row = screen.getByTestId("resource-row-0");
    // PlayerShapeIcon renders a nested <svg> with a <pattern> def — presence of an <svg>
    // inside the row is the structural signal that the identity icon was rendered.
    expect(p0Row.querySelector("svg")).not.toBeNull();
  });

  test("bases count is 0, not a crash, when a non-eliminated player has no bases on the board", () => {
    const state = resourceFixture();
    const noBasesState: GameState = {
      ...state,
      bases: state.bases.filter((b) => b.owner !== 1),
    };
    render(<ResourcePanel state={noBasesState} />);
    const p1Row = screen.getByTestId("resource-row-1");
    expect(within(p1Row).getByTestId("resource-bases").textContent).toBe("0");
  });
});
