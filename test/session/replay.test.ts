// ABOUTME: Replay-equivalence property tests (spec §7): record -> replay reproduces terminal state + every boundary hash.
// ABOUTME: Also pins SessionRecord codec round-trip survives replay, and advanceRound-count equality.
import { test, expect } from "vitest";
import * as fc from "fast-check";
import { recordGame } from "../../src/session/record";
import { replayLog } from "../../src/session/replay";
import { encodeRecord, decodeRecord } from "../../src/session/codec";
import { greedyHeader, heuristicHeader } from "./helpers";

test("record -> replay reproduces the terminal state and every boundary hash (fixed seeds)", () => {
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    const rec = recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 });
    const replay = replayLog(rec.header, rec.log);
    expect(replay.state).toEqual(rec.finalState);              // structural terminal equality
    expect(replay.boundaryHashes).toEqual(rec.boundaryHashes); // every round boundary matches
  }
});

test("PROPERTY: over random seeds and player counts, replay == record", () => {
  fc.assert(fc.property(fc.bigUintN(32), fc.integer({ min: 2, max: 6 }), (sLow, n) => {
    const rec = recordGame(greedyHeader(n, { seed: sLow + 1n }), { turnCap: 120 });
    const replay = replayLog(rec.header, rec.log);
    // fast-check treats a thrown assertion as a counterexample — assert inside the property.
    expect(replay.state).toEqual(rec.finalState);
    expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
  }), { numRuns: 50 });
});

test("advanceRound is driven the same number of times on replay (boundary count == record)", () => {
  const rec = recordGame(greedyHeader(4, { seed: 7n }), { turnCap: 300 });
  const replay = replayLog(rec.header, rec.log);
  expect(replay.boundaryHashes.length).toBe(rec.boundaryHashes.length);
});

test("a SessionRecord that round-trips through JSON replays identically", () => {
  const rec = recordGame(greedyHeader(4, { seed: 7n }), { turnCap: 300 });
  const json = JSON.parse(JSON.stringify(encodeRecord(rec.header, rec.log)));
  const { header, log } = decodeRecord(json);
  const replay = replayLog(header, log);
  expect(replay.state).toEqual(rec.finalState);
  expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
});

// HEURISTIC seats consume a VARIABLE number of policy draws during selection (samplePolicy),
// a riskier rngBeforeApply path than greedy — pin replay equivalence on it too (codex round-2).
test("record -> replay reproduces heuristic-seat games (variable-draw policy RNG path)", () => {
  for (const s of [1n, 4n, 9n]) {
    const rec = recordGame(heuristicHeader(4, { seed: s }), { turnCap: 150 });
    const replay = replayLog(rec.header, rec.log);
    expect(replay.state).toEqual(rec.finalState);
    expect(replay.boundaryHashes).toEqual(rec.boundaryHashes);
  }
});
