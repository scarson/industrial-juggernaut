// ABOUTME: Pins tooltipData() against a fixed setup-phase state for the iron/empty/occupied-base
// ABOUTME: cases described in the P1.6 fixture (controlOf + board.iron + bases/factories lookup).
import { describe, expect, test } from "vitest";
import { tooltipData } from "./tooltip";
import { initGame, defaultConfig } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";

// Fixed-seed setup-phase fixture (2 players, size-96 board) — deterministic across runs, same
// convention as territory.test.ts's setupState(). board.iron[0] on this exact seed/size is
// (1,-1,0) (probed once via a scratch script; the board is procedurally generated so seed+size
// pin it).
function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

const IRON_HEX = { x: 1, y: -1, z: 0 };
// Distance 1 from IRON_HEX — well inside config.radius=5, so a base here radiates control over it.
const BASE_HEX = { x: 0, y: 0, z: 0 };
// Distance 6 from BASE_HEX (same direction as the in-disk hexes territory.test.ts uses at
// distance 5) — outside every player's radius-5 disk and not the iron hex: a plain empty hex.
const EMPTY_HEX = { x: 6, y: -6, z: 0 };

// Places a single fresh base for player 0 at BASE_HEX, structurally overridden onto the setup
// state like territory.test.ts's radiatingFixtureState() — turn advanced past 0 so bases are
// meaningful (a turn-0 GameState with bases is a fixture convenience, not a reachable engine
// state, same documented override territory.test.ts uses).
function stateWithBase(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { ...base.phase, turn: 1 },
    bases: [{ owner: 0 as const, hex: BASE_HEX, state: "fresh" as const, order: 0 }],
  };
}

describe("tooltipData", () => {
  test("an iron hex inside one player's territory: controlledBy that player, isIron true, no occupant", () => {
    const state = stateWithBase();
    const data = tooltipData(state, IRON_HEX);
    expect(data).toEqual({ controlledBy: 0, isIron: true, occupant: null });
  });

  test("an empty hex outside any territory: controlledBy null, isIron false, no occupant", () => {
    const state = stateWithBase();
    const data = tooltipData(state, EMPTY_HEX);
    expect(data).toEqual({ controlledBy: null, isIron: false, occupant: null });
  });

  test("an occupied base hex: occupant is \"base\", still reports controlledBy/isIron for that hex", () => {
    const state = stateWithBase();
    const data = tooltipData(state, BASE_HEX);
    expect(data).toEqual({ controlledBy: 0, isIron: false, occupant: "base" });
  });
});
