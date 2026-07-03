// ABOUTME: Pins configGroups/validateConfig/provenance against the real RuleConfig shape —
// ABOUTME: the exhaustiveness check guards against a future engine knob landing ungrouped.
import { describe, expect, test } from "vitest";
import { configGroups, knobDescriptor, validateConfig, provenance } from "./config-form";
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

describe("knobDescriptor", () => {
  test("every RuleConfig key has a descriptor with a non-empty human label", () => {
    for (const key of Object.keys(defaultConfig()) as (keyof RuleConfig)[]) {
      const d = knobDescriptor(key);
      expect(d, `descriptor for ${key}`).toBeDefined();
      expect(d.label.length, `label for ${key}`).toBeGreaterThan(0);
      expect(d.label, `label for ${key} should be a human string, not the knob key`).not.toBe(
        key,
      );
    }
  });

  test("boardSize: min/max are exactly the values where validateConfig flips", () => {
    const d = knobDescriptor("boardSize");
    expect(d.type).toBe("int");
    if (d.type !== "int") return;
    expect(d.max).toBeDefined();
    const rejects = (v: number) =>
      validateConfig({ ...defaultConfig(), boardSize: v }).some((e) => e.knob === "boardSize");
    expect(rejects(d.min), "boardSize at descriptor min should validate").toBe(false);
    expect(rejects(d.min - 1), "boardSize below descriptor min should fail").toBe(true);
    expect(rejects(d.max!), "boardSize at descriptor max should validate").toBe(false);
    expect(rejects(d.max! + 1), "boardSize above descriptor max should fail").toBe(true);
  });

  test("every int knob's min (and max where present) is exactly where validateConfig flips", () => {
    for (const key of Object.keys(defaultConfig()) as (keyof RuleConfig)[]) {
      const d = knobDescriptor(key);
      if (d.type !== "int") continue;
      const rejects = (v: number) =>
        validateConfig({ ...defaultConfig(), [key]: v } as RuleConfig).some(
          (e) => e.knob === key,
        );
      expect(rejects(d.min), `${key} at descriptor min ${d.min} should validate`).toBe(false);
      expect(rejects(d.min - 1), `${key} below descriptor min should fail`).toBe(true);
      if (d.max !== undefined) {
        expect(rejects(d.max), `${key} at descriptor max ${d.max} should validate`).toBe(false);
        expect(rejects(d.max + 1), `${key} above descriptor max should fail`).toBe(true);
      }
    }
  });

  test("killBounty: enum descriptor whose options are exactly what validateConfig accepts", () => {
    const d = knobDescriptor("killBounty");
    expect(d.type).toBe("enum");
    if (d.type !== "enum") return;
    expect(d.options).toEqual(["full", "half", "none"]);
    for (const opt of d.options) {
      const cfg = { ...defaultConfig(), killBounty: opt } as RuleConfig;
      expect(
        validateConfig(cfg).some((e) => e.knob === "killBounty"),
        `option ${opt} should validate`,
      ).toBe(false);
    }
    const bad = { ...defaultConfig(), killBounty: "double" } as unknown as RuleConfig;
    expect(validateConfig(bad).some((e) => e.knob === "killBounty")).toBe(true);
  });

  test("combatTable: table descriptor whose rows are exactly the keys validateConfig requires", () => {
    const d = knobDescriptor("combatTable");
    expect(d.type).toBe("table");
    if (d.type !== "table") return;
    expect(d.rows).toEqual([3, 4, 5, 6]);
    for (const row of d.rows) {
      const table = { ...defaultConfig().combatTable } as Partial<Record<number, number>>;
      delete table[row];
      const cfg = { ...defaultConfig(), combatTable: table } as RuleConfig;
      expect(
        validateConfig(cfg).some((e) => e.knob === "combatTable"),
        `table missing descriptor row ${row} should fail validation`,
      ).toBe(true);
    }
  });

  test("boolean knobs get bool descriptors", () => {
    expect(knobDescriptor("autoWinAt6").type).toBe("bool");
    expect(knobDescriptor("allowPass").type).toBe("bool");
  });

  test("labels named in the design brief are pinned", () => {
    expect(knobDescriptor("boardSize").label).toBe("Board size");
    expect(knobDescriptor("ironCount").label).toBe("Iron deposits");
    expect(knobDescriptor("combatTable").label).toBe("Combat odds table");
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
