// ABOUTME: Pins the rules-page vignette scenes — deterministic, engine-built states that
// ABOUTME: illustrate specific rules (placement ring, radiating disks, hull perimeter, attack).
import { describe, expect, test } from "vitest";
import { ruleScene, RULE_SCENE_KEYS } from "./scenes";

describe("ruleScene", () => {
  test("every scene key builds a non-empty board and is deterministic", () => {
    for (const key of RULE_SCENE_KEYS) {
      const a = ruleScene(key);
      const b = ruleScene(key);
      expect(a.state.board.hexes.length, key).toBeGreaterThan(0);
      expect(a.state, key).toEqual(b.state);
    }
  });

  test("the placement scene is a setup-phase state with a legal outer ring to highlight", () => {
    const scene = ruleScene("placement");
    expect(scene.state.phase.turn).toBe(0);
    expect(scene.highlights?.placementHexes.size ?? 0).toBeGreaterThan(0);
  });

  test("the perimeter scene shows a hull regime (a player with 4+ bases)", () => {
    const scene = ruleScene("perimeter");
    const counts = new Map<number, number>();
    for (const b of scene.state.bases) counts.set(b.owner, (counts.get(b.owner) ?? 0) + 1);
    expect([...counts.values()].some((n) => n >= 4)).toBe(true);
  });

  test("the radiating scene shows the disk regime (every player under 4 bases)", () => {
    const scene = ruleScene("radiating");
    const counts = new Map<number, number>();
    for (const b of scene.state.bases) counts.set(b.owner, (counts.get(b.owner) ?? 0) + 1);
    expect([...counts.values()].every((n) => n < 4)).toBe(true);
    expect(scene.state.bases.length).toBeGreaterThan(0);
  });

  test("the attack scene highlights at least one legal attack target", () => {
    const scene = ruleScene("attack");
    expect(scene.highlights?.attackTargets.size ?? 0).toBeGreaterThan(0);
  });
});
