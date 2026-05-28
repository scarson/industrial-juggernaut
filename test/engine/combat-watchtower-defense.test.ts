// ABOUTME: Tests for Tactical Depth Phase 4 — watchtower +1 defense in combat.
// ABOUTME: attackWinProbability gives commit-1 lookup when defender is a watchtower (gated on baseTypesEnabled).

import { describe, expect, it } from "vitest";
import { attackWinProbability, resolveCombat } from "../../src/engine/combat";
import { defaultConfig } from "../../src/engine/config";
import { seed } from "../../src/rng/pcg";

describe("attackWinProbability — watchtower defense (Phase 4)", () => {
  const cfgOff = { ...defaultConfig(), baseTypesEnabled: false };
  const cfgOn = { ...defaultConfig(), baseTypesEnabled: true };

  it("flag off: every defender type returns combatTable[commit] regardless of subtype", () => {
    for (const def of ["forge", "watchtower", "outpost"] as const) {
      expect(attackWinProbability(cfgOff, 3, def)).toBe(0.75);
      expect(attackWinProbability(cfgOff, 4, def)).toBeCloseTo(5 / 6, 9);
      expect(attackWinProbability(cfgOff, 5, def)).toBeCloseTo(8 / 9, 9);
      expect(attackWinProbability(cfgOff, 6, def)).toBe(1); // autoWinAt6
    }
  });

  it("flag on: forge and outpost behave like flag off", () => {
    for (const def of ["forge", "outpost"] as const) {
      expect(attackWinProbability(cfgOn, 3, def)).toBe(0.75);
      expect(attackWinProbability(cfgOn, 4, def)).toBeCloseTo(5 / 6, 9);
      expect(attackWinProbability(cfgOn, 5, def)).toBeCloseTo(8 / 9, 9);
      expect(attackWinProbability(cfgOn, 6, def)).toBe(1);
    }
  });

  it("flag on, watchtower defender: commit shifts down by 1 in table lookup; commit=3 floored at 0.5", () => {
    expect(attackWinProbability(cfgOn, 3, "watchtower")).toBe(0.5);  // synthetic floor
    expect(attackWinProbability(cfgOn, 4, "watchtower")).toBe(0.75); // table[3]
    expect(attackWinProbability(cfgOn, 5, "watchtower")).toBeCloseTo(5 / 6, 9); // table[4]
    expect(attackWinProbability(cfgOn, 6, "watchtower")).toBeCloseTo(8 / 9, 9); // table[5]
  });

  it("flag on, watchtower defender + commit=6: NOT an auto-win (autoWinAt6 suppressed)", () => {
    // Verify it goes through the PRNG-draw branch, not the deterministic auto-win path.
    const rng = seed(123n);
    const result = resolveCombat(rng, 6, cfgOn, "watchtower");
    // The result.state must DIFFER from the input rng because nextFloat was called.
    expect(result.state).not.toEqual(rng);
  });

  it("resolveCombat with default defenderType = forge preserves existing callers' behavior", () => {
    const rng = seed(456n);
    const a = resolveCombat(rng, 4, cfgOff);
    const b = resolveCombat(rng, 4, cfgOff, "forge");
    expect(a).toEqual(b);
  });
});
