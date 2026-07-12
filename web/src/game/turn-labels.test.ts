// ABOUTME: Pins turn-labels — the pure derivations feeding the top-bar turn chip / seed readout
// ABOUTME: and the play screen's turn banner, all on the 1-based on-screen player convention.
import { describe, expect, test } from "vitest";
import { turnLabel, seedLabel } from "./turn-labels";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { GameState, SessionHeader } from "../engine-client/barrel";

function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

function header(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 12345n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "human" }],
  };
}

describe("turnLabel", () => {
  test("setup phase names the placing player 1-based", () => {
    const state = setupState(); // phase.turn === 0, currentPlayer === 0
    expect(turnLabel(state)).toMatch(/setup/i);
    expect(turnLabel(state)).toMatch(/player 1/i);
    expect(turnLabel(state)).not.toMatch(/player 0/i);
  });

  test("play phase carries the turn number and the acting player's round", () => {
    const state: GameState = { ...setupState(), phase: { turn: 3, order: [1, 0], indexInOrder: 0 } };
    expect(turnLabel(state)).toMatch(/turn 3/i);
    expect(turnLabel(state)).toMatch(/player 2/i); // order[0] === seat 1 → "Player 2"
  });
});

describe("seedLabel", () => {
  test("carries the seed and the generated board size in mono-ready plain text", () => {
    expect(seedLabel(header())).toBe("seed 12345 · 96 hexes");
  });

  test("a fixed board reads as fixed, not a size it does not have", () => {
    const h: SessionHeader = {
      ...header(),
      boardSource: { kind: "fixed", def: { hexes: [], iron: [] } },
    };
    expect(seedLabel(h)).toBe("seed 12345 · fixed board");
  });
});
