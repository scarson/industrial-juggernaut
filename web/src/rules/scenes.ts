// ABOUTME: ruleScene — deterministic, engine-built board states illustrating specific rules on the
// ABOUTME: rules page (placement ring, radiating disks, hull perimeter, attack range + target).
import { defaultConfig, initGame } from "../engine-client/barrel";
import { highlightSets } from "../board/highlight";
import type { HighlightSets } from "../board/highlight";
import type { GameState, Hex } from "../engine-client/barrel";

export const RULE_SCENE_KEYS = ["placement", "radiating", "perimeter", "attack"] as const;
export type RuleSceneKey = (typeof RULE_SCENE_KEYS)[number];

export type RuleScene = {
  state: GameState;
  /** Cell decorations that carry the rule being illustrated (legal ring, attack target). */
  highlights?: HighlightSets;
  /** Marks to point the eye at (rendered as the brass selection). */
  emphasis?: Hex[];
};

/** The shared deterministic baseline every scene curates from — the same seed-1/96-hex board the
 *  test-fixture family uses, so scene geometry is stable across releases unless deliberately moved. */
function baseline(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

const h = (x: number, y: number, z: number): Hex => ({ x, y, z });

/** A curated play-phase state: bases are placed structurally (the same technique the component
 *  test fixtures use) because each scene teaches ONE configuration — a scripted sequence of real
 *  placements would couple the illustration to agent/legality churn for no didactic gain. */
function playScene(bases: GameState["bases"]): GameState {
  const base = baseline();
  return {
    ...base,
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases,
    players: base.players.map((p) => ({
      ...p,
      basesInHand: 12 - bases.filter((b) => b.owner === p.id).length,
    })),
  };
}

/**
 * Builds the scene for one rules illustration. Deterministic by construction: a fixed seed, fixed
 * curated pieces, and highlight sets derived from the pure engine — two calls return equal states.
 */
export function ruleScene(key: RuleSceneKey): RuleScene {
  switch (key) {
    // Setup: the whole outer ring is a legal first-base choice (Ruling 6).
    case "placement": {
      const state = baseline();
      return { state, highlights: highlightSets(state) };
    }

    // Building/territory before a perimeter exists: each base radiates a control disk.
    case "radiating": {
      const state = playScene([
        { owner: 0, hex: h(4, -4, 0), state: "fresh", order: 0 },
        { owner: 0, hex: h(2, -1, -1), state: "fresh", order: 1 },
        { owner: 1, hex: h(-4, 4, 0), state: "fresh", order: 0 },
      ]);
      return { state };
    }

    // Territory: four or more bases form a convex-hull perimeter that claims its interior
    // (Ruling 1) — shown against a still-radiating opponent for contrast.
    case "perimeter": {
      const state = playScene([
        { owner: 0, hex: h(0, 0, 0), state: "fresh", order: 0 },
        { owner: 0, hex: h(4, -4, 0), state: "fresh", order: 1 },
        { owner: 0, hex: h(4, 0, -4), state: "fresh", order: 2 },
        { owner: 0, hex: h(0, 4, -4), state: "fresh", order: 3 },
        { owner: 1, hex: h(-4, 4, 0), state: "fresh", order: 0 },
      ]);
      return { state };
    }

    // Combat: enemy bases inside attack range are targets; the danger edge marks them.
    case "attack": {
      const state = playScene([
        { owner: 0, hex: h(0, 0, 0), state: "fresh", order: 0 },
        { owner: 0, hex: h(-1, 1, 0), state: "fresh", order: 1 },
        { owner: 0, hex: h(0, 1, -1), state: "fresh", order: 2 },
        { owner: 0, hex: h(1, 0, -1), state: "fresh", order: 3 },
        { owner: 1, hex: h(2, -2, 0), state: "fresh", order: 0 },
        { owner: 1, hex: h(0, -1, 1), state: "fresh", order: 1 },
      ]);
      return { state, highlights: highlightSets(state) };
    }
  }
}
