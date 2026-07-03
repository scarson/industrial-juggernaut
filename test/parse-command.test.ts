// ABOUTME: Node-project unit tests for parseClientCommand — the full-shape wire-command validator (Layer 1 of the
// ABOUTME: DoS-by-shape defense). Table-driven over every ClientCommand variant x its malformable fields.
import { describe, expect, test } from "vitest";
import { parseClientCommand } from "../src/host/parse-command";
import type { ClientCommand } from "../src/wire/protocol";

const HEX = { x: 0, y: 0, z: 0 };
const HEX2 = { x: 1, y: -1, z: 0 };
const HEX3 = { x: 2, y: -2, z: 0 };

// Every WELL-FORMED command variant — the validator MUST accept each (regression guard: no legal command rejected).
const WELL_FORMED: ReadonlyArray<{ name: string; cmd: ClientCommand }> = [
  { name: "hello", cmd: { type: "hello", protocolVersion: 1, replayVersion: "v1" } },
  { name: "claimSeat", cmd: { type: "claimSeat", requestId: "r1", seat: 0 } },
  { name: "placeFirstBase", cmd: { type: "placeFirstBase", expectedLogIndex: 0, hex: HEX } },
  {
    name: "build",
    cmd: { type: "build", expectedLogIndex: 3, pieces: [{ type: "base", hex: HEX }, { type: "factory", hex: HEX2 }] },
  },
  { name: "build (empty pieces — legality is the reducer's job)", cmd: { type: "build", expectedLogIndex: 3, pieces: [] } },
  {
    name: "attack",
    cmd: { type: "attack", expectedLogIndex: 5, decl: { target: HEX, attackers: [HEX2, HEX3], defender: HEX } },
  },
  { name: "endRound", cmd: { type: "endRound", expectedLogIndex: 7 } },
  { name: "pass", cmd: { type: "pass", expectedLogIndex: 7 } },
  {
    name: "resolveDecision",
    cmd: { type: "resolveDecision", expectedLogIndex: 5, decisionId: "d1", defender: HEX2 },
  },
  { name: "extendDecision", cmd: { type: "extendDecision", decisionId: "d1" } },
  { name: "resync", cmd: { type: "resync" } },
];

describe("parseClientCommand — accepts every well-formed variant (no legal command rejected)", () => {
  for (const { name, cmd } of WELL_FORMED) {
    test(`accepts ${name}`, () => {
      expect(parseClientCommand(cmd)).toBe(cmd); // returns the same value, narrowed
    });
  }
});

// Every SHAPE-MALFORMED payload the reducer would otherwise dereference into an uncaught throw (or silent corruption).
// The validator MUST reject each → null. This is the DoS lake: every variant x each malformable field.
const MALFORMED: ReadonlyArray<{ name: string; value: unknown }> = [
  // non-objects / missing or unknown type
  { name: "null", value: null },
  { name: "a bare string", value: "resync" },
  { name: "a number", value: 42 },
  { name: "an array", value: [{ type: "resync" }] },
  { name: "an object with no type", value: { expectedLogIndex: 0 } },
  { name: "an unknown type", value: { type: "definitelyNotACommand" } },
  // hello
  { name: "hello missing protocolVersion", value: { type: "hello", replayVersion: "v1" } },
  { name: "hello non-number protocolVersion", value: { type: "hello", protocolVersion: "1", replayVersion: "v1" } },
  { name: "hello missing replayVersion", value: { type: "hello", protocolVersion: 1 } },
  // claimSeat
  { name: "claimSeat missing requestId", value: { type: "claimSeat", seat: 0 } },
  { name: "claimSeat non-string requestId", value: { type: "claimSeat", requestId: 5, seat: 0 } },
  { name: "claimSeat missing seat", value: { type: "claimSeat", requestId: "r" } },
  { name: "claimSeat non-number seat", value: { type: "claimSeat", requestId: "r", seat: "0" } },
  // placeFirstBase
  { name: "placeFirstBase missing expectedLogIndex", value: { type: "placeFirstBase", hex: HEX } },
  { name: "placeFirstBase null hex", value: { type: "placeFirstBase", expectedLogIndex: 0, hex: null } },
  { name: "placeFirstBase non-number hex.x", value: { type: "placeFirstBase", expectedLogIndex: 0, hex: { x: "a", y: 0, z: 0 } } },
  { name: "placeFirstBase partial hex (missing z)", value: { type: "placeFirstBase", expectedLogIndex: 0, hex: { x: 0, y: 0 } } },
  { name: "placeFirstBase NaN hex.x", value: { type: "placeFirstBase", expectedLogIndex: 0, hex: { x: NaN, y: 0, z: 0 } } },
  // build
  { name: "build missing expectedLogIndex", value: { type: "build", pieces: [] } },
  { name: "build null pieces", value: { type: "build", expectedLogIndex: 0, pieces: null } },
  { name: "build string pieces", value: { type: "build", expectedLogIndex: 0, pieces: "x" } },
  { name: "build number pieces", value: { type: "build", expectedLogIndex: 0, pieces: 5 } },
  { name: "build piece is empty object", value: { type: "build", expectedLogIndex: 0, pieces: [{}] } },
  { name: "build piece missing hex", value: { type: "build", expectedLogIndex: 0, pieces: [{ type: "base" }] } },
  { name: "build piece bad kind", value: { type: "build", expectedLogIndex: 0, pieces: [{ type: "tower", hex: HEX }] } },
  { name: "build piece null hex", value: { type: "build", expectedLogIndex: 0, pieces: [{ type: "base", hex: null }] } },
  { name: "build one good one bad piece", value: { type: "build", expectedLogIndex: 0, pieces: [{ type: "base", hex: HEX }, {}] } },
  // attack
  { name: "attack missing expectedLogIndex", value: { type: "attack", decl: { target: HEX, attackers: [HEX2], defender: HEX } } },
  { name: "attack null decl", value: { type: "attack", expectedLogIndex: 0, decl: null } },
  { name: "attack decl target null", value: { type: "attack", expectedLogIndex: 0, decl: { target: null, attackers: [HEX2], defender: HEX } } },
  { name: "attack decl attackers number", value: { type: "attack", expectedLogIndex: 0, decl: { target: HEX, attackers: 5, defender: HEX } } },
  { name: "attack decl attackers string", value: { type: "attack", expectedLogIndex: 0, decl: { target: HEX, attackers: "abc", defender: HEX } } },
  { name: "attack decl attackers with a bad hex", value: { type: "attack", expectedLogIndex: 0, decl: { target: HEX, attackers: [HEX2, { x: 0 }], defender: HEX } } },
  { name: "attack decl missing defender", value: { type: "attack", expectedLogIndex: 0, decl: { target: HEX, attackers: [HEX2] } } },
  { name: "attack decl defender null", value: { type: "attack", expectedLogIndex: 0, decl: { target: HEX, attackers: [HEX2], defender: null } } },
  // endRound / pass
  { name: "endRound missing expectedLogIndex", value: { type: "endRound" } },
  { name: "endRound non-number expectedLogIndex", value: { type: "endRound", expectedLogIndex: "7" } },
  { name: "pass missing expectedLogIndex", value: { type: "pass" } },
  // resolveDecision
  { name: "resolveDecision missing decisionId", value: { type: "resolveDecision", expectedLogIndex: 0, defender: HEX } },
  { name: "resolveDecision missing defender", value: { type: "resolveDecision", expectedLogIndex: 0, decisionId: "d" } },
  { name: "resolveDecision null defender", value: { type: "resolveDecision", expectedLogIndex: 0, decisionId: "d", defender: null } },
  { name: "resolveDecision missing expectedLogIndex", value: { type: "resolveDecision", decisionId: "d", defender: HEX } },
  // extendDecision
  { name: "extendDecision missing decisionId", value: { type: "extendDecision" } },
  { name: "extendDecision non-string decisionId", value: { type: "extendDecision", decisionId: 5 } },
];

describe("parseClientCommand — rejects every shape-malformed payload (→ null)", () => {
  for (const { name, value } of MALFORMED) {
    test(`rejects ${name}`, () => {
      expect(parseClientCommand(value)).toBeNull();
    });
  }
});
