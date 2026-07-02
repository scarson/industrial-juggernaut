// ABOUTME: turnRollover ironWeights (A6.3) — 2-player draw-ceremony weights vs. the 3+ player null case.
// ABOUTME: Synthetic boards driven through commitEntries/driveOneStep (agent-drive.test.ts patterns), unequal iron per player (testing-pitfalls §8).
import { test, expect } from "vitest";
import { driveOneStep } from "../../src/session/agent-drive";
import { openSession } from "../../src/session/session";
import { control } from "../../src/engine/control";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { Agent } from "../../src/agent/agent";
import type { Base, GameState, Hex, PlayerId } from "../../src/engine/types";
import type { SessionHeader, SeatConfig } from "../../src/session/types";
import type { SessionState } from "../../src/session/session-types";

const IDS = { nowEpochMs: 1_000_000, decisionId: "test-decision" };
const SYNTH_CONFIG = defaultConfig();

/** A valid cube-coordinate hex (x+y+z=0). */
function hex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}

function base(owner: PlayerId, h: Hex, order: number): Base {
  return { owner, hex: h, state: "fresh", order };
}

/** A fake agent that always passes and makes no draws (mirrors agent-drive.test.ts's passAgent). */
const passAgent: Agent = (state, _p) => ({ action: { kind: "pass" }, state });

/** A minimal synthetic board large enough to hold every base/iron hex used below. */
function synthGame(bases: Base[], iron: Hex[], nPlayers: number): GameState {
  const allHexes = new Set<string>();
  const hexes: Hex[] = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      const h = hex(x, y);
      if (Math.abs(h.z) <= 6 && !allHexes.has(key(h))) {
        allHexes.add(key(h));
        hexes.push(h);
      }
    }
  }
  return {
    board: { hexes, iron },
    bases,
    factories: [],
    players: Array.from({ length: nPlayers }, (_, id) => ({ id, basesInHand: 12, alliance: [id], eliminated: false })),
    phase: { turn: 3, order: Array.from({ length: nPlayers }, (_, i) => i), indexInOrder: 0 },
    factorySupply: 36,
    config: SYNTH_CONFIG,
    rngState: seed(1n),
  };
}

/** A SessionState over a synthetic game, all seats human so driveOneStep is invoked explicitly per test
 *  (mirrors agent-drive.test.ts's synthSession); non-zero logLength so log:N keys are unambiguous. */
function synthSession(game: GameState, seatKinds: SeatConfig[]): SessionState {
  const hdr: SessionHeader = {
    formatVersion: 1,
    replayVersion: "test",
    seed: 42n,
    config: SYNTH_CONFIG,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: seatKinds,
  };
  const s = openSession(hdr, DEFAULT_ROOM_OPTIONS);
  return { ...s, game, logLength: 7 };
}

// 2-player fixture: player 0 holds TWO bases (2 controlled iron hexes), player 1 holds ONE base (1 controlled
// iron hex) — DIFFERENT iron counts so ironWeights[0] !== ironWeights[1], discriminating indexing (a swap would
// be caught). Iron sits ON each base's own hex (testing-pitfalls §8 — keeps every player alive through
// applyEliminations' noIron check when the pass is applied via commitEntries).
const P0_BASE_A = hex(0, 0);
const P0_BASE_B = hex(3, 0);
const P1_BASE = hex(-3, 0);
const TWO_PLAYER_IRON: Hex[] = [P0_BASE_A, P0_BASE_B, P1_BASE];

function twoPlayerBases(): Base[] {
  return [base(0, P0_BASE_A, 0), base(0, P0_BASE_B, 1), base(1, P1_BASE, 2)];
}

test("2-player round close: turnRollover carries non-null ironWeights[pid] == control(game, pid).iron.length, unswapped", () => {
  const pre = synthGame(twoPlayerBases(), TWO_PLAYER_IRON, 2);
  const s = synthSession(pre, [{ kind: "human" }, { kind: "human" }]);

  const res = driveOneStep(s, () => passAgent, IDS);

  // The pass closes the round.
  expect(res.advanced).toBe(true);
  expect(res.terminal).toBeNull();

  const rollovers = res.effects.broadcast.filter((m) => m.type === "turnRollover");
  expect(rollovers).toHaveLength(1);
  const rollover = rollovers[0]!;
  if (rollover.type !== "turnRollover") throw new Error("expected turnRollover");

  expect(rollover.ironWeights).not.toBeNull();
  const weights = rollover.ironWeights!;
  expect(weights).toHaveLength(2);

  // Mechanism assertion: each entry independently recomputed via control() on the post-close state
  // (res.next.game — the SAME state whose order is broadcast).
  const postState = res.next.game;
  const expected0 = control(postState, 0).iron.length;
  const expected1 = control(postState, 1).iron.length;
  expect(weights[0]).toBe(expected0);
  expect(weights[1]).toBe(expected1);

  // Sanity: the fixture actually discriminates indexing (weights differ, so a swap would be caught).
  expect(expected0).not.toBe(expected1);
  expect(weights[0]).not.toBe(weights[1]);
});

// 3-player fixture: three single-base players, each with iron on its own base hex.
const P3_BASE_0 = hex(0, 0);
const P3_BASE_1 = hex(-3, 0);
const P3_BASE_2 = hex(3, -3);
const THREE_PLAYER_IRON: Hex[] = [P3_BASE_0, P3_BASE_1, P3_BASE_2];

function threePlayerBases(): Base[] {
  return [base(0, P3_BASE_0, 0), base(1, P3_BASE_1, 1), base(2, P3_BASE_2, 2)];
}

test("3-player round close: turnRollover carries ironWeights: null (DER #13 — order rule not iron-weighted)", () => {
  const pre = synthGame(threePlayerBases(), THREE_PLAYER_IRON, 3);
  const s = synthSession(pre, [{ kind: "human" }, { kind: "human" }, { kind: "human" }]);

  const res = driveOneStep(s, () => passAgent, IDS);

  expect(res.advanced).toBe(true);
  expect(res.terminal).toBeNull();

  const rollovers = res.effects.broadcast.filter((m) => m.type === "turnRollover");
  expect(rollovers).toHaveLength(1);
  const rollover = rollovers[0]!;
  if (rollover.type !== "turnRollover") throw new Error("expected turnRollover");
  expect(rollover.ironWeights).toBeNull();
});
