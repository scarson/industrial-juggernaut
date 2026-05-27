import { describe, it, expect } from "vitest";
import { seed } from "../../src/rng/pcg";
import { resolveCombat } from "../../src/engine/combat";
import { defaultConfig } from "../../src/engine/config";

describe("resolveCombat", () => {
  it("commit 6 is automatic", () => {
    expect(resolveCombat(seed(1n), 6, defaultConfig()).attackerWon).toBe(true);
  });
  it("empirical win-rate matches the table within tolerance", () => {
    for (const commit of [3, 4, 5] as const) {
      let s = seed(123n), wins = 0; const N = 20000;
      for (let i = 0; i < N; i++) { const r = resolveCombat(s, commit, defaultConfig()); if (r.attackerWon) wins++; s = r.state; }
      expect(wins / N).toBeCloseTo(defaultConfig().combatTable[commit], 1);
    }
  });
  it("commit 6 auto-win does not consume the PRNG", () => {
    const s = seed(7n);
    const r = resolveCombat(s, 6, defaultConfig());
    expect(r.state).toBe(s);
  });
  it("commit 3 with a fixed seed is deterministic and reproducible", () => {
    const a = resolveCombat(seed(42n), 3, defaultConfig());
    const b = resolveCombat(seed(42n), 3, defaultConfig());
    expect(a.attackerWon).toBe(b.attackerWon);
    expect(a.state).toEqual(b.state);
  });
});
