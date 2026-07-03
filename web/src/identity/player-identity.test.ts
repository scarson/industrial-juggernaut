// ABOUTME: Tests the id -> {colorVar, shape, pattern} mapping that gives each player a
// ABOUTME: CVD-safe identity — color, shape, and pattern are three independently-readable channels.
import { describe, expect, test } from "vitest";
import { playerIdentity, PLAYER_SHAPES, type PlayerShape, type PlayerPattern } from "./player-identity";
import { color } from "../design/tokens";

const ALL_IDS = [0, 1, 2, 3, 4, 5] as const;

describe("playerIdentity", () => {
  test("is total over ids 0-5", () => {
    for (const id of ALL_IDS) {
      expect(() => playerIdentity(id)).not.toThrow();
    }
  });

  test("id 0 is pinned to oxide-red / circle", () => {
    const identity = playerIdentity(0);
    expect(identity.colorVar).toBe(color("oxide"));
    expect(identity.shape).toBe("circle");
  });

  test("mapping is stable across repeated calls", () => {
    for (const id of ALL_IDS) {
      const first = playerIdentity(id);
      const second = playerIdentity(id);
      expect(second).toEqual(first);
    }
  });

  test("all 6 shapes are distinct across the 6 player ids", () => {
    const shapes = ALL_IDS.map((id) => playerIdentity(id).shape);
    expect(new Set(shapes).size).toBe(6);
    for (const shape of shapes) {
      expect(PLAYER_SHAPES).toContain(shape);
    }
  });

  test("all 6 colorVars are distinct across the 6 player ids", () => {
    const colorVars = ALL_IDS.map((id) => playerIdentity(id).colorVar);
    expect(new Set(colorVars).size).toBe(6);
  });

  test("all 6 patterns are distinct across the 6 player ids", () => {
    const patterns = ALL_IDS.map((id) => playerIdentity(id).pattern);
    expect(new Set(patterns).size).toBe(6);
  });

  test("cobalt (id 1) and violet (id 2) get maximally distinct hard-edged shapes", () => {
    // cobalt x violet is the CVD floor pair (deutan ΔE ~9.4, barely above gate) — shape
    // carries the identity distinction for this pair, so it must not be two round-ish
    // shapes that blur at hex-token size.
    const cobalt = playerIdentity(1);
    const violet = playerIdentity(2);
    const roundish: PlayerShape[] = ["circle", "pentagon", "six-point"];
    expect(roundish).not.toContain(cobalt.shape);
    expect(roundish).not.toContain(violet.shape);
    expect(cobalt.shape).not.toBe(violet.shape);
  });

  test("out-of-range ids throw a clear error", () => {
    expect(() => playerIdentity(6)).toThrow(/2.*6|player/i);
    expect(() => playerIdentity(-1)).toThrow(/2.*6|player/i);
    expect(() => playerIdentity(100)).toThrow(/2.*6|player/i);
  });

  test("non-integer ids throw", () => {
    expect(() => playerIdentity(1.5)).toThrow();
  });
});
