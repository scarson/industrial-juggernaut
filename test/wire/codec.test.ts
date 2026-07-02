// ABOUTME: Round-trip tests for the wire state/pending codecs (bigint bit-exactness).
import { test, expect } from "vitest";
import { initGame, defaultConfig } from "../../src/index";
import { encodeState, decodeState, encodePending, decodePending } from "../../src/wire/codec";
import { stateHash } from "../../src/session/hash";
import type { EncodedPending } from "../../src/wire/protocol";

test("encodeState→decodeState round-trips rngState bigints bit-exactly", () => {
  const state = initGame({ seed: 12345678901234567890n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 3, config: defaultConfig() });
  const round = decodeState(encodeState(state));
  expect(round.rngState.state).toBe(state.rngState.state); // bigint ===, no precision loss
  expect(round.rngState.inc).toBe(state.rngState.inc);
  expect(round).toEqual(state); // full-object equality, not just spot-checked fields
});

test("EncodedState survives real JSON serialization (the actual wire path)", () => {
  const state = initGame({ seed: 12345678901234567890n, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 3, config: defaultConfig() });
  // JSON.stringify throws on bigint — this proves the encoded form is genuinely JSON-safe,
  // and pins that guarantee against any future GameState field additions carrying bigints.
  const overTheWire = JSON.parse(JSON.stringify(encodeState(state)));
  const round = decodeState(overTheWire);
  expect(round.rngState.state).toBe(state.rngState.state);
  expect(round.rngState.inc).toBe(state.rngState.inc);
  // Generated boards carry -0 cube coords; JSON canonicalizes -0 to 0, which is inert for the
  // engine (hex identity is key()'s template-literal string, GEO-4, and String(-0) === "0";
  // all numeric comparisons use ===, where -0 === 0). So wire fidelity is asserted by the
  // protocol's own divergence detector, stateHash — not by Object.is-style deep equality,
  // which JSON cannot honor for -0.
  expect(stateHash(round)).toBe(stateHash(state));
});

test("encodePending/decodePending round-trip the wire pending shape", () => {
  const p: EncodedPending = {
    decisionId: "d1", kind: "defenderChoice", round: 3, declaringPlayer: 0,
    promptedSeat: 1, target: { x: 0, y: 0, z: 0 },           // engine Hex is {x,y,z} cube coords
    eligibleDefenders: [{ x: 1, y: -1, z: 0 }], deadlineEpochMs: null,
  };
  expect(decodePending(encodePending(p))).toEqual(p);
});
