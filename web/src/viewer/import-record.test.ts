// ABOUTME: Pins parseSessionRecord — validates a PASTED SessionRecord as untrusted input (bad JSON,
// ABOUTME: missing fields, undecodable bigint, wrong formatVersion, oversized log) → friendly errors.
import { describe, expect, test } from "vitest";
import { MAX_IMPORT_LOG_ENTRIES, parseSessionRecord } from "./import-record";
import { encodeRecord } from "../engine-client/barrel";
import { HEADER_FORMAT_VERSION, HEADER_REPLAY_VERSION } from "../designer/new-game-form";
import { defaultConfig } from "../engine-client/barrel";
import { recordGame } from "../../../src/session/record";
import type { SessionHeader } from "../engine-client/barrel";
import type { SessionRecord } from "../engine-client/barrel";
import { buildFrames } from "./stepper";

// A real recorded game, encoded to the wire SessionRecord — the honest round-trip fixture. Small,
// fixed-seed, fast (agents are fine in the node/jsdom test process; only the CLIENT bundle bars them).
function recordFixture(): SessionRecord {
  const header: SessionHeader = {
    formatVersion: HEADER_FORMAT_VERSION,
    replayVersion: HEADER_REPLAY_VERSION,
    seed: 777n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 150, ironCount: 18 },
    seats: [
      { kind: "agent", agent: "greedy", archetype: "aggressive" },
      { kind: "agent", agent: "greedy", archetype: "economic" },
    ],
  };
  const { log } = recordGame(header, { turnCap: 20 });
  return encodeRecord(header, log);
}

function validJson(): string {
  return JSON.stringify(recordFixture());
}

describe("parseSessionRecord — the happy round-trip", () => {
  test("a real encoded record parses and its decoded form drives buildFrames", () => {
    const rec = recordFixture();
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The decoded record is exactly what buildFrames consumes: a header (bigint seed) + LogEntry[].
    expect(result.record.header.seed).toBe(BigInt(rec.seed));
    const frames = buildFrames(result.record.header, result.record.log);
    expect(frames.length).toBe(result.record.log.length + 1);
    expect(frames[0]!.logIndex).toBe(-1);
  });

  test("an empty log is valid (a game recorded to setup only)", () => {
    const rec = recordFixture();
    const result = parseSessionRecord(JSON.stringify({ ...rec, log: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.log).toEqual([]);
  });
});

describe("parseSessionRecord — malformed JSON", () => {
  test("garbage text is a friendly error, not a thrown SyntaxError", () => {
    const result = parseSessionRecord("}{ not json at all");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/json/i);
  });

  test("empty string is a friendly error", () => {
    const result = parseSessionRecord("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/json|empty/i);
  });

  test("truncated JSON (valid prefix, cut off) is a friendly error", () => {
    const truncated = validJson().slice(0, 40);
    const result = parseSessionRecord(truncated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/json/i);
  });

  test("a JSON value that isn't an object (array, number, string, null) is rejected", () => {
    for (const notObj of ["[]", "42", '"a string"', "null", "true"]) {
      const result = parseSessionRecord(notObj);
      expect(result.ok, notObj).toBe(false);
    }
  });
});

describe("parseSessionRecord — missing / wrong-typed top-level fields", () => {
  const REQUIRED_FIELDS = ["formatVersion", "replayVersion", "seed", "config", "boardSource", "seats", "log"] as const;

  for (const field of REQUIRED_FIELDS) {
    test(`a record missing "${field}" is rejected with a field-named error`, () => {
      const rec = recordFixture() as Record<string, unknown>;
      delete rec[field];
      const result = parseSessionRecord(JSON.stringify(rec));
      expect(result.ok, field).toBe(false);
      if (result.ok) return;
      expect(result.errors.join(" "), field).toContain(field);
    });
  }

  test("seats must be an array", () => {
    const rec = { ...recordFixture(), seats: "not-an-array" };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/seats/i);
  });

  test("log must be an array", () => {
    const rec = { ...recordFixture(), log: { not: "an array" } };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/log/i);
  });
});

describe("parseSessionRecord — formatVersion gate", () => {
  test("a future formatVersion is rejected with a version error", () => {
    const rec = { ...recordFixture(), formatVersion: HEADER_FORMAT_VERSION + 1 };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/version/i);
  });

  test("a non-numeric formatVersion is rejected", () => {
    const rec = { ...recordFixture(), formatVersion: "1" };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/version/i);
  });
});

describe("parseSessionRecord — undecodable bigint", () => {
  test("a seed that BigInt() cannot parse is a friendly error, not a thrown SyntaxError", () => {
    const rec = { ...recordFixture(), seed: "not-a-number" };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/seed/i);
  });

  test("a seed that is not a string is rejected", () => {
    const rec = { ...recordFixture(), seed: 777 };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
  });

  test("an entry with an undecodable rngBeforeApply is a friendly error", () => {
    const rec = recordFixture();
    // Corrupt the first entry's rng state string so decodeRng's BigInt() throws.
    const bad: SessionRecord = {
      ...rec,
      log: [
        { ...rec.log[0]!, rngBeforeApply: { state: "xyz", inc: "1" } } as SessionRecord["log"][number],
        ...rec.log.slice(1),
      ],
    };
    const result = parseSessionRecord(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/decode|entry|log|rng/i);
  });

  test("a log entry that isn't an object is rejected", () => {
    const rec = recordFixture();
    const bad = { ...rec, log: ["not-an-entry"] };
    const result = parseSessionRecord(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  test("a log entry with an unknown kind is rejected", () => {
    const rec = recordFixture();
    const bad = { ...rec, log: [{ player: 0, kind: "teleport", rngBeforeApply: { state: "1", inc: "1" } }] };
    const result = parseSessionRecord(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/kind|entry|log/i);
  });
});

describe("parseSessionRecord — boardSource validation (confirmed defect: PR #59 review)", () => {
  test("boardSource.def: null (fixed kind, null def) is rejected, not passed through to buildFrames", () => {
    const rec = { ...recordFixture(), boardSource: { kind: "fixed", def: null } };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/board/i);
  });

  test("boardSource.def with a non-integer / invariant-violating hex is rejected", () => {
    const rec = {
      ...recordFixture(),
      boardSource: { kind: "fixed", def: { hexes: [{ x: 0.5, y: 0, z: 0 }], iron: [] } },
    };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/board|hex|integer|invariant/i);
  });

  test("boardSource.def with an iron hex that is not a member of hexes is rejected", () => {
    const rec = {
      ...recordFixture(),
      boardSource: {
        kind: "fixed",
        def: {
          hexes: [{ x: 0, y: 0, z: 0 }],
          iron: [{ x: 5, y: -5, z: 0 }],
        },
      },
    };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/iron/i);
  });

  test("boardSource.size over the DER #16 cap is rejected fast (fast-reject proves no ovalHexes DoS hang)", () => {
    const rec = { ...recordFixture(), boardSource: { kind: "generate", size: 10_000, ironCount: 18 } };
    const start = Date.now();
    const result = parseSessionRecord(JSON.stringify(rec));
    const elapsedMs = Date.now() - start;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/size|board/i);
    // A fix that rejects the size BEFORE calling ovalHexes returns near-instantly; a fix that lets
    // it through would hang for a very long time (guard<2000 iterations, each O(size) — minutes).
    expect(elapsedMs).toBeLessThan(1000);
  });

  test("boardSource.size at 1e9 (pathological) is rejected fast", () => {
    const rec = { ...recordFixture(), boardSource: { kind: "generate", size: 1e9, ironCount: 18 } };
    const start = Date.now();
    const result = parseSessionRecord(JSON.stringify(rec));
    const elapsedMs = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(elapsedMs).toBeLessThan(1000);
  });
});

describe("parseSessionRecord — config validation (confirmed defect: PR #59 review)", () => {
  test("config: null is rejected with a friendly error, not passed through to validateConfig", () => {
    const rec = { ...recordFixture(), config: null };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/config/i);
  });

  test("config: a non-object (string) is rejected", () => {
    const rec = { ...recordFixture(), config: "not-a-config" };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/config/i);
  });

  test("config: an array is rejected (not a plain object)", () => {
    const rec = { ...recordFixture(), config: [1, 2, 3] };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/config/i);
  });

  test("config: an object missing required knobs is rejected without throwing inside validateConfig", () => {
    const rec = { ...recordFixture(), config: {} };
    expect(() => parseSessionRecord(JSON.stringify(rec))).not.toThrow();
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/config/i);
  });

  test("config: an out-of-range knob value is rejected", () => {
    const rec = { ...recordFixture(), config: { ...defaultConfig(), boardSize: -1 } };
    const result = parseSessionRecord(JSON.stringify(rec));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/boardSize/i);
  });
});

describe("parseSessionRecord — oversized log cap (negative-property, testing-pitfalls §4)", () => {
  test(`a log longer than the ${MAX_IMPORT_LOG_ENTRIES}-entry cap is rejected before decoding`, () => {
    const rec = recordFixture();
    const oneEntry = rec.log[0] ?? { player: 0, kind: "pass", rngBeforeApply: { state: "1", inc: "1" } };
    const huge = Array.from({ length: MAX_IMPORT_LOG_ENTRIES + 1 }, () => oneEntry);
    const result = parseSessionRecord(JSON.stringify({ ...rec, log: huge }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/too large|too long|cap|limit|entries/i);
  });

  test("a log exactly at the cap is not rejected for size (decode may still run)", () => {
    // Guards the off-by-one: the cap is a ceiling, not an exclusive bound. We can't cheaply build a
    // decodable MAX-length log, so assert only that the SIZE error is absent at the boundary.
    const rec = recordFixture();
    const oneEntry = rec.log[0] ?? { player: 0, kind: "pass", rngBeforeApply: { state: "1", inc: "1" } };
    const atCap = Array.from({ length: MAX_IMPORT_LOG_ENTRIES }, () => oneEntry);
    const result = parseSessionRecord(JSON.stringify({ ...rec, log: atCap }));
    if (!result.ok) {
      expect(result.errors.join(" ")).not.toMatch(/too large|too long|cap|limit/i);
    }
  });
});
