// ABOUTME: Pins the transport-layer error message shapes (MALFORMED/UNKNOWN_TYPE/OVERSIZED).
// ABOUTME: Verifies exact code, dynamic-content presence in message, and currentLogIndex default/passthrough.
import { test, expect } from "vitest";
import { malformedError, unknownTypeError, oversizedError } from "../../src/session/errors";

test("malformedError produces a MALFORMED error carrying the detail, defaulting currentLogIndex to null", () => {
  const msg = malformedError("bad JSON: unexpected token");
  expect(msg).toEqual({
    type: "error",
    code: "MALFORMED",
    message: expect.stringContaining("bad JSON: unexpected token"),
    currentLogIndex: null,
  });
});

test("malformedError passes through an explicit currentLogIndex", () => {
  const msg = malformedError("missing field: type", 42);
  expect(msg).toMatchObject({ currentLogIndex: 42 });
});

test("unknownTypeError produces an UNKNOWN_TYPE error carrying the offending type, defaulting currentLogIndex to null", () => {
  const msg = unknownTypeError("frobnicate");
  expect(msg).toEqual({
    type: "error",
    code: "UNKNOWN_TYPE",
    message: expect.stringContaining("frobnicate"),
    currentLogIndex: null,
  });
});

test("unknownTypeError passes through an explicit currentLogIndex", () => {
  const msg = unknownTypeError("frobnicate", 7);
  expect(msg).toMatchObject({ currentLogIndex: 7 });
});

test("oversizedError produces an OVERSIZED error carrying both byte counts, defaulting currentLogIndex to null", () => {
  const msg = oversizedError(20000, 16384);
  expect(msg).toEqual({
    type: "error",
    code: "OVERSIZED",
    message: expect.stringMatching(/20000.*16384|16384.*20000/s),
    currentLogIndex: null,
  });
});

test("oversizedError passes through an explicit currentLogIndex", () => {
  const msg = oversizedError(20000, 16384, 3);
  expect(msg).toMatchObject({ currentLogIndex: 3 });
});
