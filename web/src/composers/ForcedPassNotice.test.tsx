// ABOUTME: Structure tests for ForcedPassNotice — shown only when legalActions(state) yields
// ABOUTME: nothing but pass, rendering the DER #5 one-liner. A notice only: it does not auto-submit.
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForcedPassNotice } from "./ForcedPassNotice";
import { makeFakeDriver } from "../game/fake-driver";
import { hex } from "../../../src/geometry/cube";
import { defaultConfig, initGame, legalActions } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { SeatRosterEntry } from "../game/driver";

function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// Stuck-player fixture: p0 has exactly one base, no controlled iron (the sole iron deposit sits
// outside placeRange/attackRange-relevant control radius), and p1 has no base within attackRange
// — legalActions falls through every build/attack branch and returns exactly [{kind:"pass"}].
// Mirrors test/engine/legal.test.ts's "stuck player" fixture (iron placed far enough away that
// buildBudget's control radius (5) excludes it).
const P0_BASE = hex(0, 0, 0);
const FAR_IRON = hex(6, -6, 0); // distance 6 > control radius 5 => uncontrolled, budget stays 0
const FAR_P1_BASE = hex(10, -5, -5); // outside attackRange (6) of P0_BASE => no legal attack

function stuckFixture(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map((h) => `${h.x},${h.y},${h.z}`));
  const extra = [FAR_IRON, FAR_P1_BASE].filter((h) => !present.has(`${h.x},${h.y},${h.z}`));
  return {
    ...base,
    board: { ...base.board, hexes: [...base.board.hexes, ...extra], iron: [FAR_IRON] },
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [
      { owner: 0, hex: P0_BASE, state: "fresh", order: 0 },
      { owner: 1, hex: FAR_P1_BASE, state: "fresh", order: 0 },
    ],
    players: [
      { id: 0, basesInHand: 11, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 11, alliance: [1], eliminated: false },
    ],
  };
}

// A normal play-phase fixture with a real build action available (same shape as
// BuildComposer.test.tsx's playFixture) — proves ForcedPassNotice stays silent when a legal
// build/attack action exists, not just when one happens to be absent from this file's fixtures.
const PLAY_IRON = hex(2, -2, 0);

function unstuckFixture(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map((h) => `${h.x},${h.y},${h.z}`));
  const extra = present.has(`${PLAY_IRON.x},${PLAY_IRON.y},${PLAY_IRON.z}`) ? [] : [PLAY_IRON];
  return {
    ...base,
    board: { ...base.board, hexes: [...base.board.hexes, ...extra], iron: [PLAY_IRON] },
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [{ owner: 0, hex: P0_BASE, state: "fresh", order: 0 }],
    players: [
      { id: 0, basesInHand: 11, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 12, alliance: [1], eliminated: false },
    ],
  };
}

function fixtureRoster(): SeatRosterEntry[] {
  return [
    { seat: 0, claimed: true, kind: "human" },
    { seat: 1, claimed: true, kind: "human" },
  ];
}

function driverFor(state: GameState) {
  return makeFakeDriver({ snapshot: state, roster: fixtureRoster(), controllableSeats: [0] });
}

describe("ForcedPassNotice — sanity on the fixture", () => {
  test("stuckFixture really does reduce to pass-only under legalActions", () => {
    const state = stuckFixture();
    expect(legalActions(state)).toEqual([{ kind: "pass" }]);
  });

  test("unstuckFixture has a legal build action available", () => {
    const state = unstuckFixture();
    expect(legalActions(state).some((a) => a.kind === "build")).toBe(true);
  });
});

describe("ForcedPassNotice — notice + DER #5 rule line", () => {
  test("renders the auto-notice and the DER #5 explanation when forced-pass is detected", () => {
    const state = stuckFixture();
    const driver = driverFor(state);

    render(<ForcedPassNotice state={state} driver={driver} />);

    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/voluntary pass is illegal/i)).toBeInTheDocument();
  });

  test("renders nothing when a legal build or attack action exists", () => {
    const state = unstuckFixture();
    const driver = driverFor(state);

    render(<ForcedPassNotice state={state} driver={driver} />);

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  // Documented contract: ForcedPassNotice is a NOTICE only — it informs the player that pass is
  // the only legal action and shows the rule, but it does not itself call driver.submit. Sending
  // `{type:"pass"}` on the player's behalf is left to an explicit affordance (out of this
  // component's scope) or to a caller that wires one up; mounting this component must never have
  // the side effect of submitting a command with no user action, which is the safer contract for
  // a component the game screen may mount/unmount as `pending`/state changes.
  test("mounting the notice does NOT submit anything on its own", () => {
    const state = stuckFixture();
    const driver = driverFor(state);

    render(<ForcedPassNotice state={state} driver={driver} />);

    expect(driver.submitted()).toEqual([]);
  });
});
