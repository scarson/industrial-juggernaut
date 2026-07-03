// ABOUTME: Pins parseBoardSource's friendly-error gate for both generate-kind numeric input
// ABOUTME: and fixed-kind untrusted JSON paste, ahead of any engine loadBoard() call.
import { describe, expect, test } from "vitest";
import { parseBoardSource } from "./board-source";
import type { BoardSourceValidation, GenerateFieldError } from "./board-source";

// Narrows a result to the generate-kind failure arm, asserting the discriminants along
// the way; throws (failing the test) if the result is any other arm.
function expectGenerateErrors(result: BoardSourceValidation): GenerateFieldError[] {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a validation failure");
  expect(result.kind).toBe("generate");
  if (result.kind !== "generate") throw new Error("expected generate-kind field errors");
  return result.errors;
}

// Same, for the fixed-kind failure arm (flat string errors — see the
// BoardSourceValidation docblock for why the two arms are shaped differently).
function expectFixedErrors(result: BoardSourceValidation): string[] {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a validation failure");
  expect(result.kind).toBe("fixed");
  if (result.kind !== "fixed") throw new Error("expected fixed-kind errors");
  return result.errors;
}

describe("parseBoardSource — generate", () => {
  test("accepts a valid generate source", () => {
    const result = parseBoardSource({ kind: "generate", size: 96, ironCount: 14 });
    expect(result).toEqual({
      ok: true,
      source: { kind: "generate", size: 96, ironCount: 14 },
    });
  });

  test("rejects size below the DER #16 floor (95 invalid)", () => {
    const errors = expectGenerateErrors(
      parseBoardSource({ kind: "generate", size: 95, ironCount: 14 }),
    );
    expect(errors.some((e) => e.field === "size" && e.message.includes("96"))).toBe(true);
  });

  test("rejects size above the DER #16 ceiling (301 invalid)", () => {
    const errors = expectGenerateErrors(
      parseBoardSource({ kind: "generate", size: 301, ironCount: 14 }),
    );
    expect(errors.some((e) => e.field === "size" && e.message.includes("300"))).toBe(true);
  });

  test("rejects a non-integer size", () => {
    const errors = expectGenerateErrors(
      parseBoardSource({ kind: "generate", size: 96.5, ironCount: 14 }),
    );
    expect(errors.some((e) => e.field === "size" && /integer/i.test(e.message))).toBe(true);
  });

  test("rejects ironCount below 1", () => {
    const errors = expectGenerateErrors(
      parseBoardSource({ kind: "generate", size: 96, ironCount: 0 }),
    );
    expect(errors.some((e) => e.field === "ironCount" && /at least 1/.test(e.message))).toBe(
      true,
    );
  });

  test("rejects a non-integer ironCount", () => {
    const errors = expectGenerateErrors(
      parseBoardSource({ kind: "generate", size: 96, ironCount: 3.5 }),
    );
    expect(errors.some((e) => e.field === "ironCount" && /integer/i.test(e.message))).toBe(
      true,
    );
  });

  test("accumulates field-keyed errors for multiple bad fields", () => {
    const errors = expectGenerateErrors(
      parseBoardSource({ kind: "generate", size: 400, ironCount: 0 }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e) => e.field === "size")).toBe(true);
    expect(errors.some((e) => e.field === "ironCount")).toBe(true);
  });
});

describe("parseBoardSource — fixed (untrusted JSON)", () => {
  const validDef = {
    hexes: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: -1, y: 1, z: 0 },
    ],
    iron: [{ x: 0, y: 0, z: 0 }],
  };

  test("accepts a valid fixed board definition", () => {
    const result = parseBoardSource({ kind: "fixed", raw: JSON.stringify(validDef) });
    expect(result).toEqual({
      ok: true,
      source: { kind: "fixed", def: validDef },
    });
  });

  test("non-JSON input produces a friendly parse error, not a stack trace", () => {
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: "{not valid json" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/couldn't parse json/i);
    expect(errors[0]).not.toMatch(/at JSON\.parse|\.ts:\d+/);
  });

  test("empty string input produces a friendly parse error", () => {
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: "" }));
    expect(errors[0]).toMatch(/couldn't parse json/i);
  });

  test("a hex violating the cube invariant produces a friendly error naming the offending hex", () => {
    const def = {
      hexes: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 }, // 1+1+0 = 2, violates x+y+z===0
      ],
      iron: [{ x: 0, y: 0, z: 0 }],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => e.includes("1,1,0") || e.includes("(1, 1, 0)"))).toBe(true);
    expect(errors.some((e) => /x\s*\+\s*y\s*\+\s*z/.test(e))).toBe(true);
  });

  test("iron hex not present in hexes produces a friendly error", () => {
    const def = {
      hexes: [{ x: 0, y: 0, z: 0 }],
      iron: [{ x: 5, y: -5, z: 0 }],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /iron/i.test(e) && e.includes("5"))).toBe(true);
  });

  test("empty hexes array is rejected", () => {
    const def = { hexes: [], iron: [] };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /hexes/i.test(e) && /empty/i.test(e))).toBe(true);
  });

  test("empty iron array is rejected", () => {
    const def = {
      hexes: [{ x: 0, y: 0, z: 0 }],
      iron: [],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /iron/i.test(e) && /empty/i.test(e))).toBe(true);
  });

  test("duplicate hexes in the pasted def are rejected with a friendly error naming the duplicate", () => {
    const def = {
      hexes: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      iron: [{ x: 0, y: 0, z: 0 }],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(
      errors.some((e) => /duplicate/i.test(e) && (e.includes("0,0,0") || e.includes("(0, 0, 0)"))),
    ).toBe(true);
  });

  test("duplicate hexes in iron are rejected with a friendly error", () => {
    const def = {
      hexes: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: -1, z: 0 },
      ],
      iron: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /duplicate/i.test(e) && /iron/i.test(e))).toBe(true);
  });

  test("a 10k-hex paste is rejected fast via the size cap, not hung on", () => {
    const hexes = [];
    for (let i = 0; i < 10_000; i++) {
      hexes.push({ x: i, y: -i, z: 0 });
    }
    const def = { hexes, iron: [hexes[0]] };
    const start = Date.now();
    const result = parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) });
    const elapsedMs = Date.now() - start;
    const errors = expectFixedErrors(result);
    expect(errors.some((e) => /too many hexes/i.test(e))).toBe(true);
    expect(elapsedMs).toBeLessThan(1000);
  });

  test("NUL byte in the raw JSON string is rejected with a friendly parse error", () => {
    // The \x00 escape keeps this source file NUL-free (so git diffs it as text) while
    // JSON.parse still receives a literal NUL byte at runtime.
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: '{"hexes": [\x00]}' }));
    expect(errors[0]).toMatch(/couldn't parse json/i);
  });

  test("unicode content in the raw JSON string does not crash and is rejected as bad shape", () => {
    const errors = expectFixedErrors(
      parseBoardSource({ kind: "fixed", raw: '{"hexes": "🎲🀄️", "iron": []}' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  test("hexes not an array produces a friendly shape error", () => {
    const errors = expectFixedErrors(
      parseBoardSource({
        kind: "fixed",
        raw: JSON.stringify({ hexes: "nope", iron: [] }),
      }),
    );
    expect(errors.some((e) => /hexes/i.test(e))).toBe(true);
  });

  test("a hex missing a coordinate field produces a friendly shape error", () => {
    const def = {
      hexes: [{ x: 0, y: 0 }], // missing z
      iron: [{ x: 0, y: 0, z: 0 }],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /z/i.test(e))).toBe(true);
  });

  test("a hex with a non-numeric coordinate produces a friendly shape error", () => {
    const def = {
      hexes: [{ x: "zero", y: 0, z: 0 }],
      iron: [{ x: "zero", y: 0, z: 0 }],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /x/i.test(e))).toBe(true);
  });

  test("top-level JSON that isn't an object produces a friendly shape error", () => {
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: "42" }));
    expect(errors.length).toBeGreaterThan(0);
  });

  test("unknown extra top-level keys are rejected on the untrusted gate", () => {
    const def = { ...validDef, extra: "surprise" };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /extra/i.test(e) && /unknown/i.test(e))).toBe(true);
  });

  test("does not call the engine's loadBoard — the friendly gate precedes any engine throw", () => {
    // A def that would throw inside loadBoard's own checkCoords (non-integer coordinate)
    // must be caught here with a friendly message, never let an engine exception surface.
    const def = {
      hexes: [{ x: 0.5, y: 0, z: -0.5 }],
      iron: [],
    };
    expect(() => parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) })).not.toThrow();
  });

  test("a non-integer hex coordinate is rejected, not just non-throwing (matches loadBoard's own integer check)", () => {
    // x=0.5/z=-0.5 satisfy Number.isFinite AND the cube invariant (0.5 + 0 + -0.5 === 0), so this
    // hex would previously sail through this gate and only fail inside loadBoard's own
    // Number.isInteger check — an uncaught throw at game-init time, not a friendly error here.
    const def = {
      hexes: [{ x: 0.5, y: 0, z: -0.5 }],
      iron: [{ x: 0.5, y: 0, z: -0.5 }],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /integer/i.test(e))).toBe(true);
  });

  test("a hex coordinate exceeding the engine's MAX_BOARD_COORD bound is rejected", () => {
    // loadBoard throws for |coordinate| > 1024; this gate must catch it first with a friendly error.
    const def = {
      hexes: [{ x: 5000, y: -5000, z: 0 }],
      iron: [{ x: 5000, y: -5000, z: 0 }],
    };
    const errors = expectFixedErrors(parseBoardSource({ kind: "fixed", raw: JSON.stringify(def) }));
    expect(errors.some((e) => /1024|exceed|bound|coordinate/i.test(e))).toBe(true);
  });
});
