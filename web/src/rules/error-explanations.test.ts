// ABOUTME: Pins explainError — one plain-English rule sentence per DriverErrorCode. Exhaustive
// ABOUTME: over the 20-code union: every code maps to real prose, spot-checked against DERs.
import { describe, expect, test } from "vitest";
import { explainError } from "./error-explanations";
import type { DriverErrorCode } from "../game/driver";

// The 20-code union from web/src/game/driver.ts, spelled out so a code renamed or removed there
// without a matching update here is a visible failure, not a silent gap. `ALL_CODES` is derived
// from `EXPLANATION` (a Record<DriverErrorCode, string>) below, which the compiler already checks
// for totality — a new DriverErrorCode with no entry fails typecheck before this file even runs.
import { EXPLANATION } from "./error-explanations";

const ALL_CODES = Object.keys(EXPLANATION) as DriverErrorCode[];

describe("explainError", () => {
  test("covers every DriverErrorCode with real prose", () => {
    expect(ALL_CODES.length).toBe(20);
    for (const code of ALL_CODES) {
      const line = explainError(code);
      expect(line, code).toBeTypeOf("string");
      expect(line.trim(), code).not.toBe("");
      expect(line, code).not.toMatch(/todo|placeholder|tbd|fixme/i);
      expect(line, code).not.toMatch(/undefined|null|\[object|NaN/i);
      // A real sentence has more than one word and ends with terminal punctuation.
      expect(line.trim().split(/\s+/).length, code).toBeGreaterThan(3);
      expect(line.trim(), code).toMatch(/[.!]$/);
    }
  });

  test("DUP_ATTACKERS explains the no-duplicate-attacker rule", () => {
    expect(explainError("DUP_ATTACKERS")).toMatch(/same base.*(twice|more than once)|duplicate/i);
  });

  test("NO_ELIGIBLE_DEFENDER explains DER #4's unattackable ruling", () => {
    const line = explainError("NO_ELIGIBLE_DEFENDER");
    expect(line).toMatch(/no eligible defender/i);
    expect(line).toMatch(/unattackable/i);
  });

  test("PASS_NOT_FORCED explains DER #5's voluntary-pass-is-illegal ruling", () => {
    const line = explainError("PASS_NOT_FORCED");
    expect(line).toMatch(/pass/i);
    expect(line).toMatch(/forced|must (build|attack)|cannot pass|voluntary/i);
  });
});
