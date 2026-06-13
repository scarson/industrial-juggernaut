// ABOUTME: Tests for stateHash — deterministic, structural, divergence-sensitive checksum of GameState.
// ABOUTME: Equal states hash equal; any base/fatigue/rng/factory/phase difference hashes differently.
import { test, expect } from "vitest";
import { stateHash } from "../../src/session/hash";
import { initGame } from "../../src/engine/init";
import { placeFirstBase, representativeFirstBase, advanceRound } from "../../src/engine/turn";
import { defaultConfig } from "../../src/engine/config";
import type { BaseState } from "../../src/engine/types";

function setupPlayed(seed: bigint) {
  let s = initGame({ seed, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 4, config: defaultConfig() });
  for (let i = 0; i < 4; i++) { const p = s.phase.order[s.phase.indexInOrder]!; s = placeFirstBase(s, p, representativeFirstBase(s, p)); }
  return s;
}

test("equal states hash equal; the hash is a stable non-empty string", () => {
  const a = setupPlayed(7n), b = setupPlayed(7n);
  expect(stateHash(a)).toBe(stateHash(b));
  expect(typeof stateHash(a)).toBe("string");
  expect(stateHash(a).length).toBeGreaterThan(0);
});

test("advancing a round changes the hash (rng + phase moved)", () => {
  const a = setupPlayed(7n);
  expect(stateHash(advanceRound(a))).not.toBe(stateHash(a));
});

test("a different seed (different board + seating) hashes differently", () => {
  expect(stateHash(setupPlayed(7n))).not.toBe(stateHash(setupPlayed(8n)));
});

test("hash is insensitive to bases array ORDER but sensitive to membership", () => {
  const a = setupPlayed(7n);
  const reordered = { ...a, bases: [...a.bases].reverse() };
  expect(stateHash(reordered)).toBe(stateHash(a)); // structural, order-independent
  const moved = { ...a, bases: a.bases.map((bb, i) => i === 0 ? { ...bb, state: (bb.state === "fresh" ? "fatigued" : "fresh") as BaseState } : bb) };
  expect(stateHash(moved)).not.toBe(stateHash(a)); // a fatigue flip is a real difference
});
