// ABOUTME: openSession + storage-key layout tests.
import { test, expect } from "vitest";
import { defaultConfig } from "../../src/index";
import { openSession } from "../../src/session/session";
import { logKey } from "../../src/session/keys";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";

const header = {
  formatVersion: 1, replayVersion: "test", seed: 42n, config: defaultConfig(),
  boardSource: { kind: "generate" as const, size: 96, ironCount: 14 },
  seats: [{ kind: "human" as const }, { kind: "agent" as const, agent: "heuristic" as const }],
};

test("openSession starts in setup phase with empty log and unclaimed seats", () => {
  const s = openSession(header, DEFAULT_ROOM_OPTIONS);
  expect(s.game.phase.turn).toBe(0);
  expect(s.logLength).toBe(0);
  expect(s.pending).toBeNull();
  expect(s.seats.map((x) => x.authorizedDigest)).toEqual([null, null]);
  expect(s.seats.every((x) => x.claimed === false)).toBe(true);
});
test("logKey zero-pads to 6 digits", () => {
  expect(logKey(1)).toBe("log:000001");
  expect(logKey(123456)).toBe("log:123456");
});
