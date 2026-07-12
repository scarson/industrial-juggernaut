// ABOUTME: Pins explainError — one plain-English rule sentence per DriverErrorCode. Exhaustive
// ABOUTME: over the driver's error union: every code maps to real prose, spot-checked against DERs.
import { describe, expect, test } from "vitest";
import { explainError } from "./error-explanations";
import type { DriverErrorCode } from "../game/driver";
import { WIRE_ERROR_CODES } from "../../../src/wire/protocol";

// The full error union from web/src/game/driver.ts, spelled out so a code renamed or removed there
// without a matching update here is a visible failure, not a silent gap. `ALL_CODES` is derived
// from `EXPLANATION` (a Record<DriverErrorCode, string>) below, which the compiler already checks
// for totality — a new DriverErrorCode with no entry fails typecheck before this file even runs.
import { EXPLANATION } from "./error-explanations";

const ALL_CODES = Object.keys(EXPLANATION) as DriverErrorCode[];

describe("explainError", () => {
  test("covers every DriverErrorCode with real prose", () => {
    // One code per wire error code — the driver's union spans the whole WireErrorCode catalog.
    expect(ALL_CODES.length).toBe(WIRE_ERROR_CODES.length);
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

  test("BUILD_OVER_BUDGET explains the resources-halved build budget", () => {
    const line = explainError("BUILD_OVER_BUDGET");
    expect(line).toMatch(/budget|resources/i);
  });

  test("BUILD_BOOTSTRAP_FACTORY_ONLY explains the founding factory-only budget", () => {
    const line = explainError("BUILD_BOOTSTRAP_FACTORY_ONLY");
    expect(line).toMatch(/factory/i);
  });

  test("BUILD_ILLEGAL_BASE references the triangle rule (DER #7)", () => {
    const line = explainError("BUILD_ILLEGAL_BASE");
    expect(line).toMatch(/triangle|perimeter|friendly base/i);
  });

  test("VERSION_MISMATCH explains the protocol-version transport condition", () => {
    const line = explainError("VERSION_MISMATCH");
    expect(line).toMatch(/version/i);
  });
});

describe("explainError — config-sensitive copy", () => {
  test("BUILD_ILLEGAL_FACTORY reflects the game's placeRange, never a hardcoded 5", () => {
    expect(explainError("BUILD_ILLEGAL_FACTORY", { placeRange: 3 })).toMatch(/within 3\b/);
    expect(explainError("BUILD_ILLEGAL_FACTORY", { placeRange: 3 })).not.toMatch(/within 5\b/);
  });

  test("BUILD_ILLEGAL_BASE reflects the game's placeRange", () => {
    expect(explainError("BUILD_ILLEGAL_BASE", { placeRange: 8 })).toMatch(/within 8 hexes\b/);
  });

  test("without a context, placeRange-sensitive copy falls back to the engine default", () => {
    // defaultConfig().placeRange is 5 today — the fallback reads the engine default, not a literal.
    expect(explainError("BUILD_ILLEGAL_FACTORY")).toMatch(/within 5\b/);
  });
});
