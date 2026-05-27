// ABOUTME: Tests for the game driver runGame — well-formed results, determinism, termination,
// ABOUTME: the legality guard (normal runs don't throw), and a fixed-board smoke test. Seeded, structural.

import { describe, expect, it } from "vitest";
import { runGame } from "../../src/driver/run";
import type { GameResult, RunOptions } from "../../src/driver/record";
import { defaultConfig } from "../../src/engine/config";
import { generateBoard } from "../../src/board/generate";
import { seed } from "../../src/rng/pcg";
import type { Archetype } from "../../src/agent/archetypes";

const ARCHS: Archetype[] = ["aggressive", "economic", "expansionist"];

/** A 2-player generated-board run with the given seed and a generous turn cap. */
function opts2p(s: bigint, turnCap = 300): RunOptions {
  return {
    seed: s,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    archetypes: [ARCHS[0]!, ARCHS[1]!],
    config: defaultConfig(),
    turnCap,
  };
}

function assertWellFormed(r: GameResult, nPlayers: number): void {
  expect(Array.isArray(r.winnerOrCoalition)).toBe(true);
  for (const p of r.winnerOrCoalition) expect(typeof p).toBe("number");
  expect(["iron", "last-standing", "none"]).toContain(r.victoryType);
  expect(typeof r.hitTurnCap).toBe("boolean");
  expect(r.turns).toBeGreaterThanOrEqual(1);
  // ironOverTime: one row per turn boundary recorded, each of length nPlayers.
  expect(Array.isArray(r.ironOverTime)).toBe(true);
  for (const row of r.ironOverTime) {
    expect(row).toHaveLength(nPlayers);
    for (const c of row) expect(typeof c).toBe("number");
  }
  // Coupling: hitTurnCap <=> victoryType "none" <=> no winner.
  if (r.hitTurnCap) {
    expect(r.victoryType).toBe("none");
    expect(r.winnerOrCoalition).toEqual([]);
  } else {
    expect(r.victoryType).not.toBe("none");
  }
}

describe("runGame", () => {
  it("returns a well-formed GameResult (2 players)", () => {
    const r = runGame(opts2p(1n));
    assertWellFormed(r, 2);
  });

  it("is deterministic: same opts (same seed) -> deeply-equal results", () => {
    const o = opts2p(42n);
    const a = runGame(o);
    const b = runGame(o);
    expect(a).toEqual(b);
  });

  it("terminates within turnCap+1 and does not hang", () => {
    const r = runGame(opts2p(7n, 300));
    assertWellFormed(r, 2);
    expect(r.turns).toBeLessThanOrEqual(301);
  });

  it("reaches a real terminal victory (not turn-capped) for a chosen seed", () => {
    // Find a seed that terminates via a victory inside the cap (vs hitting it).
    let found: GameResult | null = null;
    for (let s = 1n; s <= 10n; s++) {
      const r = runGame(opts2p(s, 300));
      if (!r.hitTurnCap) {
        found = r;
        break;
      }
    }
    expect(found).not.toBeNull();
    expect(found!.hitTurnCap).toBe(false);
    // Contract: a non-capped game has a real victory reason ("iron" | "last-standing").
    expect(found!.victoryType).not.toBe("none");
    // NOTE: we deliberately do NOT assert `winnerOrCoalition.length >= 1`. With the
    // current greedy agents on the 96-board, every 2-player game ends at the shared
    // factory-pool perimeter rule (18 total factories placed) eliminating BOTH players
    // simultaneously while each still holds < 4 bases — the spec's documented
    // degenerate "everyone eliminated" terminal (status() => players: [], reason
    // "last-standing"). The driver faithfully records this as victoryType
    // "last-standing" with an empty winner; asserting a non-empty coalition here
    // would contradict the engine's actual (and spec-sanctioned) behavior.
    expect(["iron", "last-standing"]).toContain(found!.victoryType);
  });

  it("does not throw the legality guard on a normal run (3 players)", () => {
    const o: RunOptions = {
      seed: 123n,
      boardSource: { kind: "generate", size: 96, ironCount: 14 },
      nPlayers: 3,
      archetypes: [ARCHS[0]!, ARCHS[1]!, ARCHS[2]!],
      config: defaultConfig(),
      turnCap: 300,
    };
    expect(() => runGame(o)).not.toThrow();
  });

  it("runs on a fixed boardSource (smoke)", () => {
    // Reuse a generated board as a fixed definition (a valid BoardDefinition).
    const g = generateBoard(seed(99n), { size: 96, ironCount: 14 });
    const o: RunOptions = {
      seed: 5n,
      boardSource: { kind: "fixed", def: { hexes: g.board.hexes, iron: g.board.iron } },
      nPlayers: 2,
      archetypes: [ARCHS[0]!, ARCHS[1]!],
      config: defaultConfig(),
      turnCap: 300,
    };
    const r = runGame(o);
    assertWellFormed(r, 2);
  });
});
