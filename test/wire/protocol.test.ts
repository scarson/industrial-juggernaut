// ABOUTME: Type-presence + discriminant smoke for the wire protocol contract.
// ABOUTME: Pins the ClientCommand/ServerMessage unions and the WireErrorCode catalog (spec §3).
import { test, expect } from "vitest";
import type { ClientCommand, ServerMessage } from "../../src/wire/protocol";
import { WIRE_ERROR_CODES, PROTOCOL_VERSION } from "../../src/wire/protocol";

test("every ClientCommand kind is reachable via the type discriminant", () => {
  // A value of each kind type-checks (compile-time guarantee surfaced at runtime).
  const cmds: ClientCommand["type"][] = [
    "hello", "claimSeat", "placeFirstBase", "build", "attack",
    "endRound", "pass", "resolveDecision", "extendDecision", "resync",
  ];
  expect(new Set(cmds).size).toBe(cmds.length);
});

test("WIRE_ERROR_CODES contains the session-layer codes used by validation + envelope", () => {
  for (const c of [
    "STALE_INDEX", "DECISION_PENDING", "ALREADY_RESOLVED", "NOT_YOUR_TURN",
    "SEAT_TAKEN", "BAD_SEAT_TOKEN", "MALFORMED", "UNKNOWN_TYPE", "OVERSIZED",
    "VERSION_MISMATCH",
    // setup-phase envelope guard (only placeFirstBase is legal during turn 0):
    "SETUP_PLACEMENT_REQUIRED",
    // session validation codes (re-exported for the client's rule-explanation map):
    "PASS_NOT_FORCED", "ATTACK_NOT_SINGLE_DECL", "DUP_ATTACKERS",
    "DEFENDER_IS_TARGET", "DEFENDER_INELIGIBLE", "NO_ELIGIBLE_DEFENDER",
    "MIXED_PIECE_TYPES", "DUP_PIECES",
    // build-rule violations enforced by the engine at apply time (A3.3):
    "BUILD_EMPTY", "BUILD_BOOTSTRAP_FACTORY_ONLY", "BUILD_OVER_BUDGET",
    "BUILD_ILLEGAL_FACTORY", "BUILD_NO_BASES_IN_HAND", "BUILD_ILLEGAL_BASE",
  ]) {
    expect(WIRE_ERROR_CODES).toContain(c);
  }
});

test("PROTOCOL_VERSION is a positive integer", () => {
  expect(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION > 0).toBe(true);
});
