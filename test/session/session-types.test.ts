// ABOUTME: Type-presence + initial-shape smoke for the reducer's shared types.
import { test, expect } from "vitest";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { NO_EFFECTS, type SessionState } from "../../src/session/session-types";

test("NO_EFFECTS is the empty effects value", () => {
  expect(NO_EFFECTS).toEqual({ persist: null, broadcast: [], reply: [], toSeat: [], alarm: null });
});
test("DEFAULT_ROOM_OPTIONS has defender timeout OFF", () => {
  expect(DEFAULT_ROOM_OPTIONS.defenderTimeout.enabled).toBe(false);
});
