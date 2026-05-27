import { describe, it, expect } from "vitest";
import { defaultConfig } from "../../src/engine/config";

describe("defaultConfig", () => {
  it("matches the rules-faithful defaults", () => {
    const c = defaultConfig();
    expect(c.radius).toBe(5);
    expect(c.placeRange).toBe(5);
    expect(c.attackRange).toBe(6);
    expect(c.baseLimit).toBe(12);
    expect(c.factorySupply).toBe(36);
    expect(c.ironCount).toBe(14);
    expect(c.victoryThreshold).toBe(10);
    expect(c.brokenPerimeterDeathAtFactories).toBe(18);
    expect(c.autoWinAt6).toBe(true);
    expect(c.killBounty).toBe("full");
    expect(c.allowPass).toBe(false);
    expect(c.combatTable[3]).toBeCloseTo(0.75, 5);
    expect(c.combatTable[4]).toBeCloseTo(5 / 6, 5);
    expect(c.combatTable[5]).toBeCloseTo(8 / 9, 5);
    expect(c.combatTable[6]).toBe(1);
  });
});
