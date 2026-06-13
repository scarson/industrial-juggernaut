// ABOUTME: Targeted replay-equivalence tests at specific regime boundaries (spec §7 edge coverage).
// ABOUTME: Each test asserts the regime actually occurred before asserting replay identity — no silent no-ops.
import { test, expect } from "vitest";
import { recordGame } from "../../src/session/record";
import { replayLog } from "../../src/session/replay";
import { heuristicHeader } from "./helpers";

/**
 * Regime: mid-turn elimination.
 * Seed 256 (4p heuristic): two players are eliminated mid-game
 * (brokenPerimeterAt18Factories), producing roundSkipped entries.
 * Tests that the per-declaration composition + advanceRound threading
 * correctly handles eliminated seats without diverging on replay.
 */
test("replay equivalence at mid-turn elimination (seed=256, 4p)", () => {
  const rec = recordGame(heuristicHeader(4, { seed: 256n }), { turnCap: 400 });
  // Assert the regime occurred — elimination must have happened.
  expect(rec.events.some(e => e.kind === "eliminated")).toBe(true);
  // Assert replay identity.
  const replay = replayLog(rec.header, rec.log);
  expect(replay.state).toEqual(rec.finalState);
  expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
});

/**
 * Regime: bounty/stranding — baseDestroyed event AND an eliminated player in the same game.
 * Seed 285 (4p heuristic): a base is destroyed (stranded/bounty) and a player is eliminated,
 * exercising the per-declaration composition's removeEncircledStrandedBases step.
 */
test("replay equivalence at bounty/stranding timing (seed=285, 4p)", () => {
  const rec = recordGame(heuristicHeader(4, { seed: 285n }), { turnCap: 400 });
  // Assert the regime: a base was destroyed AND a player was eliminated.
  expect(rec.events.some(e => e.kind === "baseDestroyed" || e.kind === "baseReplaced")).toBe(true);
  expect(rec.events.some(e => e.kind === "eliminated")).toBe(true);
  // Assert replay identity.
  const replay = replayLog(rec.header, rec.log);
  expect(replay.state).toEqual(rec.finalState);
  expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
});

/**
 * Regime: 3↔4 base crossing (a player reaches ≥4 bases = perimeter).
 * Seed 2 (4p heuristic): player 3 ends with 5 bases, crossing the
 * radiating→perimeter boundary mid-game.
 */
test("replay equivalence at ≥4-base (perimeter) regime crossing (seed=2, 4p)", () => {
  const rec = recordGame(heuristicHeader(4, { seed: 2n }), { turnCap: 300 });
  // Assert the regime: some player reached ≥4 bases (check the final state).
  const playerBaseCounts: Record<number, number> = {};
  for (const b of rec.finalState.bases) {
    playerBaseCounts[b.owner] = (playerBaseCounts[b.owner] ?? 0) + 1;
  }
  expect(Math.max(...Object.values(playerBaseCounts))).toBeGreaterThanOrEqual(4);
  // Assert replay identity.
  const replay = replayLog(rec.header, rec.log);
  expect(replay.state).toEqual(rec.finalState);
  expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
});

/**
 * Regime: ≥2 commitment levels in attack declarations.
 * Seed 67 (3p heuristic): attacks with commitment levels 3 and 4 both appear,
 * exercising the per-declaration composition across different attacker-count paths.
 */
test("replay equivalence at ≥2 commitment levels in attacks (seed=67, 3p)", () => {
  const rec = recordGame(heuristicHeader(3, { seed: 67n }), { turnCap: 200 });
  // Assert the regime: log has attack entries with at least 2 distinct commitment levels.
  const commitLevels = new Set(
    rec.log.filter(e => e.kind === "attack").map(e => (e as any).decl.attackers.length),
  );
  expect(commitLevels.size).toBeGreaterThanOrEqual(2);
  // Assert replay identity.
  const replay = replayLog(rec.header, rec.log);
  expect(replay.state).toEqual(rec.finalState);
  expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
});
