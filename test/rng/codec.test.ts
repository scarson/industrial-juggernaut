// ABOUTME: Round-trip property tests for the bigint<->decimal RngState codec.
// ABOUTME: Verifies bit-exact uint64 round-trips (incl. > 2^53) and JSON.stringify/parse survival.
import { test, expect } from "vitest";
import * as fc from "fast-check";
import { encodeRng, decodeRng } from "../../src/rng/codec";

test("encode/decode round-trips uint64 RngState bit-exactly (incl. > 2^53)", () => {
  fc.assert(fc.property(fc.bigUintN(64), fc.bigUintN(64), (s, inc) => {
    const r = { state: s, inc };
    const round = decodeRng(encodeRng(r));
    return round.state === r.state && round.inc === r.inc;
  }));
});

test("encoded form survives JSON.stringify/parse (the whole point)", () => {
  const r = { state: 18446744073709551557n, inc: 12345678901234567890n }; // both > 2^53
  const back = decodeRng(JSON.parse(JSON.stringify(encodeRng(r))));
  expect(back.state).toBe(r.state);
  expect(back.inc).toBe(r.inc);
});
