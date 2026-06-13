// ABOUTME: Pins the closed LogEntry union and the exact SessionRecord field list (spec §3).
// ABOUTME: A type+shape smoke — fails typecheck if a kind is dropped or a field renamed.
import { test, expect } from "vitest";
import { seed } from "../../src/rng/pcg";
import { hex } from "../../src/geometry/cube";
import type { LogEntry, SessionRecord, SeatConfig } from "../../src/session/types";

test("SessionRecord carries exactly the spec §3 fields", () => {
  const rec: SessionRecord = {
    formatVersion: 1,
    replayVersion: "test",
    seed: "1",
    config: { } as any, // RuleConfig — shape pinned by the engine, not here
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }],
    log: [],
  };
  expect(Object.keys(rec).sort()).toEqual(
    ["boardSource", "config", "formatVersion", "log", "replayVersion", "seats", "seed"],
  );
});

test("LogEntry union covers all six v1 kinds, each carrying player + rngBeforeApply", () => {
  const r = seed(1n);
  const entries: LogEntry[] = [
    { player: 0, kind: "placeFirstBase", hex: hex(0, 0, 0), rngBeforeApply: r },
    { player: 0, kind: "build", pieces: [{ type: "factory", hex: hex(0, 0, 0) }], rngBeforeApply: r },
    { player: 1, kind: "attack", decl: { target: hex(1, -1, 0), attackers: [hex(0,0,0)], defender: hex(2,-2,0) }, rngBeforeApply: r },
    { player: 1, kind: "endRound", rngBeforeApply: r },
    { player: 0, kind: "pass", rngBeforeApply: r },
    { player: 1, kind: "roundSkipped", rngBeforeApply: r },
  ];
  expect(entries.map((e) => e.kind).sort()).toEqual(
    ["attack", "build", "endRound", "pass", "placeFirstBase", "roundSkipped"],
  );
  for (const e of entries) { expect(typeof e.player).toBe("number"); expect(typeof e.rngBeforeApply.state).toBe("bigint"); }
});

const SEATS_OK: SeatConfig[] = [{ kind: "human" }, { kind: "agent", agent: "greedy", archetype: "economic" }, { kind: "agent", agent: "heuristic" }];
test("SeatConfig admits human, greedy(+archetype), heuristic", () => { expect(SEATS_OK).toHaveLength(3); });
