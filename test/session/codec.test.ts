// ABOUTME: Round-trip tests for the SessionRecord codec — bigint seed + per-entry rngBeforeApply survive JSON.
// ABOUTME: Bit-exact for uint64 values > 2^53; all conversion goes through the RNG codec (never Number()).
import { test, expect } from "vitest";
import * as fc from "fast-check";
import { encodeRecord, decodeRecord, encodeEntry, decodeEntry } from "../../src/session/codec";
import { hex } from "../../src/geometry/cube";
import { greedyHeader } from "./helpers";
import type { LogEntry } from "../../src/session/types";

test("a LogEntry round-trips through encode/decode and JSON, bit-exactly (incl. > 2^53)", () => {
  fc.assert(fc.property(fc.bigUintN(64), fc.bigUintN(64), (s, inc) => {
    const e: LogEntry = { player: 1, kind: "attack",
      decl: { target: hex(1,-1,0), attackers: [hex(0,0,0)], defender: hex(2,-2,0) },
      rngBeforeApply: { state: s, inc } };
    const back = decodeEntry(JSON.parse(JSON.stringify(encodeEntry(e))));
    return back.kind === "attack" && back.rngBeforeApply.state === s && back.rngBeforeApply.inc === inc;
  }));
});

test("a full SessionRecord round-trips (header bigint seed + log) through JSON", () => {
  const header = greedyHeader(2, { seed: 18446744073709551557n }); // seed > 2^53
  const log: LogEntry[] = [
    { player: 0, kind: "pass", rngBeforeApply: { state: 18189450024704157456n, inc: 109n } },
    { player: 1, kind: "endRound", rngBeforeApply: { state: 1n, inc: 109n } },
  ];
  const rec = encodeRecord(header, log);
  const round = JSON.parse(JSON.stringify(rec));
  const { header: h2, log: l2 } = decodeRecord(round);
  expect(h2.seed).toBe(header.seed);
  expect(h2).toEqual(header);
  expect(l2).toEqual(log);
  expect(typeof rec.seed).toBe("string"); // encoded form is a string
});
