// ABOUTME: Round-trip tests for the wire state/pending codecs (bigint bit-exactness).
import { test, expect } from "vitest";
import { initGame, defaultConfig } from "../../src/index";
import { encodeState, decodeState, encodePending, decodePending } from "../../src/wire/codec";
import type { EncodedPending } from "../../src/wire/protocol";

test("encodeState→decodeState round-trips rngState bigints bit-exactly", () => {
  const state = initGame({ seed: 12345678901234567890n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 3, config: defaultConfig() });
  const round = decodeState(encodeState(state));
  expect(round.rngState.state).toBe(state.rngState.state); // bigint ===, no precision loss
  expect(round.rngState.inc).toBe(state.rngState.inc);
  expect(round.bases).toEqual(state.bases);
  expect(round.phase).toEqual(state.phase);
});

test("encodePending/decodePending round-trip the wire pending shape", () => {
  const p: EncodedPending = {
    decisionId: "d1", kind: "defenderChoice", round: 3, declaringPlayer: 0,
    promptedSeat: 1, target: { x: 0, y: 0, z: 0 },           // engine Hex is {x,y,z} cube coords
    eligibleDefenders: [{ x: 1, y: -1, z: 0 }], deadlineEpochMs: null,
  };
  expect(decodePending(encodePending(p))).toEqual(p);
});
