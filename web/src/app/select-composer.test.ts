// ABOUTME: Unit tests for selectComposer — the pure phase→composer decision cascade. Covers the
// ABOUTME: pending-outranks-phase priority, setup vs play, control gating, and the forced-pass branch.
import { describe, expect, test } from "vitest";
import { hex } from "../../../src/geometry/cube";
import { defaultConfig, initGame } from "../engine-client/barrel";
import { selectComposer } from "./select-composer";
import type { GameState } from "../engine-client/barrel";
import type { DriverPending } from "../game/driver";

// Setup-phase fixture (2 players, seed-1n/size-96 board) — deterministic, `phase.turn === 0`.
function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// A normal play-phase fixture: seat 0 acting, a real build action available (rc = 3 controlled iron
// + 1 factory = 4 => budget 2). Mirrors BuildComposer.test.tsx's playFixture shape.
const PERIMETER_BASES = [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)];
const PLAY_IRON = [hex(2, -2, 0), hex(2, 0, -2), hex(1, 1, -2)];
const PLAY_FACTORY = hex(2, 1, -3);

function playState(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map((h) => `${h.x},${h.y},${h.z}`));
  const extra = [...PERIMETER_BASES, ...PLAY_IRON, PLAY_FACTORY].filter(
    (h) => !present.has(`${h.x},${h.y},${h.z}`),
  );
  return {
    ...base,
    board: { ...base.board, hexes: [...base.board.hexes, ...extra], iron: PLAY_IRON },
    factories: [{ hex: PLAY_FACTORY }],
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: PERIMETER_BASES.map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
    players: [
      { id: 0, basesInHand: 8, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 12, alliance: [1], eliminated: false },
    ],
  };
}

// Stuck-player fixture: seat 0 acting, only legal action is pass (allowPass off, no build/attack).
// Mirrors ForcedPassNotice.test.tsx's stuckFixture.
const STUCK_BASE = hex(0, 0, 0);
const FAR_IRON = hex(6, -6, 0); // distance 6 > control radius 5 => uncontrolled, budget 0
const FAR_P1_BASE = hex(10, -5, -5); // outside attackRange (6) => no legal attack

function stuckState(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map((h) => `${h.x},${h.y},${h.z}`));
  const extra = [FAR_IRON, FAR_P1_BASE].filter((h) => !present.has(`${h.x},${h.y},${h.z}`));
  return {
    ...base,
    board: { ...base.board, hexes: [...base.board.hexes, ...extra], iron: [FAR_IRON] },
    config: { ...base.config, allowPass: false },
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [
      { owner: 0, hex: STUCK_BASE, state: "fresh", order: 0 },
      { owner: 1, hex: FAR_P1_BASE, state: "fresh", order: 0 },
    ],
    players: [
      { id: 0, basesInHand: 11, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 11, alliance: [1], eliminated: false },
    ],
  };
}

function fixturePending(promptedSeat: number): DriverPending {
  return {
    decisionId: "d1",
    round: 1,
    declaringPlayer: 1,
    promptedSeat,
    target: { x: 0, y: 0, z: 0 },
    eligibleDefenders: [{ x: 1, y: -1, z: 0 }],
    deadlineEpochMs: null,
  };
}

describe("selectComposer — pending outranks everything", () => {
  test("a non-null pending yields 'defender' even in the setup phase", () => {
    // The store only sets pending for a controllable promptedSeat, so a non-null pending is always ours.
    expect(selectComposer(setupState(), fixturePending(0), [0, 1])).toBe("defender");
  });

  test("a non-null pending yields 'defender' even during the acting player's play turn", () => {
    expect(selectComposer(playState(), fixturePending(1), [0, 1])).toBe("defender");
  });
});

describe("selectComposer — setup phase", () => {
  test("setup (phase.turn === 0) with no pending yields 'setup'", () => {
    expect(selectComposer(setupState(), null, [0, 1])).toBe("setup");
  });
});

describe("selectComposer — play phase control gating", () => {
  test("a controllable acting seat with real actions yields 'play'", () => {
    expect(selectComposer(playState(), null, [0, 1])).toBe("play");
  });

  test("an acting seat this client does NOT control yields 'waiting'", () => {
    // seat 0 is acting, but this client controls only seat 1 (a human-vs-agent hotseat where seat 0 is the agent).
    expect(selectComposer(playState(), null, [1])).toBe("waiting");
  });

  test("a controllable acting seat whose only legal action is pass yields 'forcedPass'", () => {
    expect(selectComposer(stuckState(), null, [0, 1])).toBe("forcedPass");
  });

  test("a non-controllable seat outranks the forced-pass check — waiting is chosen before legalActions is consulted", () => {
    // Even in the stuck state, if it's not our seat we wait; forcedPass is only for OUR stuck turn.
    expect(selectComposer(stuckState(), null, [1])).toBe("waiting");
  });
});
