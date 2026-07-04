// ABOUTME: Pins isSetupInstantWinnable's degeneracy predicate against the default board (DER #18:
// ABOUTME: max single-base iron coverage can equal the victory threshold) and three clean configs.
import { describe, expect, test } from "vitest";
import { isSetupInstantWinnable } from "./degeneracy";
import { defaultConfig } from "../engine-client/barrel";

// Fixed seed throughout — determinism per docs/pitfalls/testing-pitfalls.md §8. Empirically
// probed (bun run against src/board/generate.ts + src/engine/turn.ts + src/engine/control.ts
// directly): at seed 1, generate/96/ironCount-14, the max single-base iron coverage over all 32
// legalFirstBaseHexes is exactly 10 at radius 5, 7 at radius 4, and 8 at boardSize 120 (radius 5).
const SEED = 1n;
const GENERATE_SOURCE = { kind: "generate" as const, size: 96, ironCount: 14 };

describe("isSetupInstantWinnable", () => {
  test("true for the degenerate default config (max coverage 10 equals threshold 10)", () => {
    const config = defaultConfig();
    expect(isSetupInstantWinnable(config, GENERATE_SOURCE, SEED)).toBe(true);
  });

  test("false when victoryThreshold is raised above max coverage (>=12)", () => {
    const config = { ...defaultConfig(), victoryThreshold: 12 };
    expect(isSetupInstantWinnable(config, GENERATE_SOURCE, SEED)).toBe(false);
  });

  test("false when the board is generated larger (boardSize >= 120), spreading iron out", () => {
    const config = defaultConfig();
    const source = { kind: "generate" as const, size: 120, ironCount: 14 };
    expect(isSetupInstantWinnable(config, source, SEED)).toBe(false);
  });

  test("false when the control radius is shrunk (radius <= 4)", () => {
    const config = { ...defaultConfig(), radius: 4 };
    expect(isSetupInstantWinnable(config, GENERATE_SOURCE, SEED)).toBe(false);
  });
});
