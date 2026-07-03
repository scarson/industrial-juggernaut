// ABOUTME: Pins configGroups/validateConfig/provenance against the real RuleConfig shape —
// ABOUTME: the exhaustiveness check guards against a future engine knob landing ungrouped.
import { describe, expect, test } from "vitest";
import { configGroups, validateConfig, provenance } from "./config-form";
import { defaultConfig } from "../engine-client/barrel";
import type { RuleConfig } from "../engine-client/barrel";

describe("configGroups", () => {
  test("covers every RuleConfig key exactly once, no more no less", () => {
    const groups = configGroups();
    const groupedKeys = Object.values(groups).flat().sort();
    const allKeys = Object.keys(defaultConfig()).sort();
    expect(groupedKeys).toEqual(allKeys);
  });

  test("has no duplicate keys across groups", () => {
    const groups = configGroups();
    const groupedKeys = Object.values(groups).flat();
    expect(new Set(groupedKeys).size).toBe(groupedKeys.length);
  });

  test("every group is non-empty", () => {
    const groups = configGroups();
    for (const [name, keys] of Object.entries(groups)) {
      expect(keys.length, `group ${name} should not be empty`).toBeGreaterThan(0);
    }
  });
});

describe("validateConfig", () => {
  test("defaultConfig() is valid", () => {
    expect(validateConfig(defaultConfig())).toEqual([]);
  });

  test("rejects ironCount below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), ironCount: 0 };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "ironCount",
      message: expect.stringContaining("at least 1"),
    });
  });

  test("accepts ironCount at exactly 1 (boundary)", () => {
    const cfg: RuleConfig = { ...defaultConfig(), ironCount: 1 };
    expect(validateConfig(cfg).some((e) => e.knob === "ironCount")).toBe(false);
  });

  test("rejects non-integer ironCount", () => {
    const cfg: RuleConfig = { ...defaultConfig(), ironCount: 3.5 };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "ironCount",
      message: expect.stringContaining("integer"),
    });
  });

  test("rejects boardSize below 96 (boundary: 95 invalid)", () => {
    const cfg: RuleConfig = { ...defaultConfig(), boardSize: 95 };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "boardSize",
      message: expect.stringContaining("96"),
    });
  });

  test("accepts boardSize at exactly 96 (boundary)", () => {
    const cfg: RuleConfig = { ...defaultConfig(), boardSize: 96 };
    expect(validateConfig(cfg).some((e) => e.knob === "boardSize")).toBe(false);
  });

  test("accepts boardSize at exactly 300 (boundary)", () => {
    const cfg: RuleConfig = { ...defaultConfig(), boardSize: 300 };
    expect(validateConfig(cfg).some((e) => e.knob === "boardSize")).toBe(false);
  });

  test("rejects boardSize above 300 (boundary: 301 invalid)", () => {
    const cfg: RuleConfig = { ...defaultConfig(), boardSize: 301 };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "boardSize",
      message: expect.stringContaining("300"),
    });
  });

  test("rejects victoryThreshold below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), victoryThreshold: 0 };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "victoryThreshold",
      message: expect.stringContaining("at least 1"),
    });
  });

  test("accepts victoryThreshold at exactly 1 (boundary)", () => {
    const cfg: RuleConfig = { ...defaultConfig(), victoryThreshold: 1 };
    expect(validateConfig(cfg).some((e) => e.knob === "victoryThreshold")).toBe(false);
  });

  test("rejects radius below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), radius: 0 };
    expect(validateConfig(cfg).some((e) => e.knob === "radius")).toBe(true);
  });

  test("rejects placeRange below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), placeRange: 0 };
    expect(validateConfig(cfg).some((e) => e.knob === "placeRange")).toBe(true);
  });

  test("rejects attackRange below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), attackRange: 0 };
    expect(validateConfig(cfg).some((e) => e.knob === "attackRange")).toBe(true);
  });

  test("rejects baseLimit below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), baseLimit: 0 };
    expect(validateConfig(cfg).some((e) => e.knob === "baseLimit")).toBe(true);
  });

  test("rejects factorySupply below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), factorySupply: 0 };
    expect(validateConfig(cfg).some((e) => e.knob === "factorySupply")).toBe(true);
  });

  test("rejects brokenPerimeterDeathAtFactories below 1", () => {
    const cfg: RuleConfig = { ...defaultConfig(), brokenPerimeterDeathAtFactories: 0 };
    expect(
      validateConfig(cfg).some((e) => e.knob === "brokenPerimeterDeathAtFactories"),
    ).toBe(true);
  });

  test("rejects non-integer boardSize", () => {
    const cfg: RuleConfig = { ...defaultConfig(), boardSize: 96.5 };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "boardSize",
      message: expect.stringContaining("integer"),
    });
  });

  test("boolean knobs (autoWinAt6, allowPass) never produce errors regardless of value", () => {
    const cfg: RuleConfig = { ...defaultConfig(), autoWinAt6: false, allowPass: true };
    expect(validateConfig(cfg).some((e) => e.knob === "autoWinAt6")).toBe(false);
    expect(validateConfig(cfg).some((e) => e.knob === "allowPass")).toBe(false);
  });

  test("rejects an unrecognized killBounty value", () => {
    const cfg = { ...defaultConfig(), killBounty: "double" } as unknown as RuleConfig;
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "killBounty",
      message: expect.stringContaining("full"),
    });
  });

  test("accepts every legal killBounty value", () => {
    for (const value of ["full", "half", "none"] as const) {
      const cfg: RuleConfig = { ...defaultConfig(), killBounty: value };
      expect(validateConfig(cfg).some((e) => e.knob === "killBounty")).toBe(false);
    }
  });

  test("rejects combatTable missing a required key", () => {
    const cfg: RuleConfig = {
      ...defaultConfig(),
      combatTable: { 3: 0.75, 4: 5 / 6, 5: 8 / 9 } as unknown as RuleConfig["combatTable"],
    };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "combatTable",
      message: expect.stringContaining("6"),
    });
  });

  test("rejects combatTable entry outside (0,1]", () => {
    const cfg: RuleConfig = {
      ...defaultConfig(),
      combatTable: { 3: 0, 4: 5 / 6, 5: 8 / 9, 6: 1 },
    };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "combatTable",
      message: expect.stringContaining("3"),
    });
  });

  test("rejects combatTable entry above 1", () => {
    const cfg: RuleConfig = {
      ...defaultConfig(),
      combatTable: { 3: 0.75, 4: 5 / 6, 5: 8 / 9, 6: 1.5 },
    };
    expect(validateConfig(cfg).some((e) => e.knob === "combatTable")).toBe(true);
  });

  test("rejects a non-monotonic combatTable (win probability must not decrease with bag size)", () => {
    const cfg: RuleConfig = {
      ...defaultConfig(),
      combatTable: { 3: 0.9, 4: 5 / 6, 5: 8 / 9, 6: 1 },
    };
    const errors = validateConfig(cfg);
    expect(errors).toContainEqual({
      knob: "combatTable",
      message: expect.stringContaining("non-decreasing"),
    });
  });

  test("accumulates multiple errors for multiple bad knobs", () => {
    const cfg: RuleConfig = { ...defaultConfig(), ironCount: 0, boardSize: 400 };
    const errors = validateConfig(cfg);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e) => e.knob === "ironCount")).toBe(true);
    expect(errors.some((e) => e.knob === "boardSize")).toBe(true);
  });
});

describe("provenance", () => {
  test("marks every knob as default for defaultConfig()", () => {
    const p = provenance(defaultConfig());
    for (const key of Object.keys(defaultConfig()) as (keyof RuleConfig)[]) {
      expect(p[key]).toBe("default");
    }
  });

  test("marks a scalar knob as tuned when changed", () => {
    const cfg: RuleConfig = { ...defaultConfig(), ironCount: 20 };
    const p = provenance(cfg);
    expect(p.ironCount).toBe("tuned");
  });

  test("leaves unchanged knobs marked default alongside a tuned one", () => {
    const cfg: RuleConfig = { ...defaultConfig(), ironCount: 20 };
    const p = provenance(cfg);
    expect(p.radius).toBe("default");
    expect(p.boardSize).toBe("default");
  });

  test("marks combatTable tuned when only one entry differs (deep compare)", () => {
    const cfg: RuleConfig = {
      ...defaultConfig(),
      combatTable: { ...defaultConfig().combatTable, 3: 0.8 },
    };
    const p = provenance(cfg);
    expect(p.combatTable).toBe("tuned");
  });

  test("marks combatTable default when structurally equal but a different object identity", () => {
    const cfg: RuleConfig = {
      ...defaultConfig(),
      combatTable: { 3: 0.75, 4: 5 / 6, 5: 8 / 9, 6: 1 },
    };
    const p = provenance(cfg);
    expect(p.combatTable).toBe("default");
  });

  test("marks killBounty tuned when changed", () => {
    const cfg: RuleConfig = { ...defaultConfig(), killBounty: "half" };
    const p = provenance(cfg);
    expect(p.killBounty).toBe("tuned");
  });

  test("marks a boolean knob tuned when flipped", () => {
    const cfg: RuleConfig = { ...defaultConfig(), autoWinAt6: false };
    const p = provenance(cfg);
    expect(p.autoWinAt6).toBe("tuned");
  });
});
