// ABOUTME: Pins the presets() record and applyPreset() lookup — including the
// ABOUTME: current-playtest-config default-equality contract and fresh-copy isolation.
import { describe, expect, test } from "vitest";
import { presets, applyPreset, BALANCE_IN_PROGRESS_NOTE } from "./presets";
import { defaultConfig } from "../engine-client/barrel";
import type { RuleConfig } from "../engine-client/barrel";

describe("presets", () => {
  test("includes current-playtest-config, deep-equal to defaultConfig() initially", () => {
    const all = presets();
    expect(all["current-playtest-config"]).toEqual(defaultConfig());
  });
});

describe("applyPreset", () => {
  test("returns the current-playtest-config value, deep-equal to defaultConfig()", () => {
    const cfg = applyPreset("current-playtest-config");
    expect(cfg).toEqual(defaultConfig());
  });

  test("returns a fresh copy each call — mutating one result does not affect the next", () => {
    const first = applyPreset("current-playtest-config");
    first.ironCount = 999;
    first.combatTable[3] = 0.01;

    const second = applyPreset("current-playtest-config");

    expect(second.ironCount).not.toBe(999);
    expect(second.combatTable[3]).not.toBe(0.01);
    expect(second).toEqual(defaultConfig());
  });

  test("throws a friendly error for an unknown preset name", () => {
    expect(() => applyPreset("nonexistent-preset" as never)).toThrow(/unknown preset/i);
  });

  test("unknown preset error message names the offending preset", () => {
    expect(() => applyPreset("nonexistent-preset" as never)).toThrow(/nonexistent-preset/);
  });
});

describe("BALANCE_IN_PROGRESS_NOTE", () => {
  test("is a non-empty string", () => {
    expect(typeof BALANCE_IN_PROGRESS_NOTE).toBe("string");
    expect(BALANCE_IN_PROGRESS_NOTE.length).toBeGreaterThan(0);
  });
});
