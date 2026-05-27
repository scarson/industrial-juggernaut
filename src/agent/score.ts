// ABOUTME: Pure move scorer for the greedy-weighted archetype agent (spec §11, roadmap Part 1).
// ABOUTME: scoreMove consumes NO PRNG — attacks are scored by expected value, never by rolling combat.

import { applyAction } from "../engine/apply";
import { control } from "../engine/control";
import { key } from "../geometry/cube";
import { convexHull, hullArea } from "../geometry/hull";
import type { Action, Base, GameState, Hex, PlayerId } from "../engine/types";

/** Linear scoring weights — one preset per archetype (filled in Task 6.2). */
export interface Weights {
  iron: number;
  fact: number;
  area: number;
  aggr: number;
  fatigueCost: number;
}

/**
 * Penalty magnitudes for the static hard-prunes. `-Infinity` is reserved for the
 * absolute prune (4th base enclosing no iron => self-elimination); the others are
 * large-but-finite so a move can still be the LEAST-bad option when every choice
 * is penalized.
 */
const IRON_DROP_PENALTY = 1e6; // dropping a held iron hex (iron is the victory metric)
const FACTORY_OUTSIDE_PENALTY = 1e3; // factory lands outside resulting controlled territory

const PERIMETER_BASE_COUNT = 4;

/** Canonical-keyed hexes of the player's bases in `state` (GEO-4). */
function baseHexesOf(state: GameState, player: PlayerId): Hex[] {
  return state.bases.filter((b) => b.owner === player).map((b) => b.hex);
}

/** Hull area over a player's base centers (0 when <3 distinct / degenerate). */
function playerHullArea(state: GameState, player: PlayerId): number {
  return hullArea(convexHull(baseHexesOf(state, player)));
}

/** Max `order` across all bases, or -1 when there are none. */
function maxOrder(bases: Base[]): number {
  let max = -1;
  for (const b of bases) if (b.order > max) max = b.order;
  return max;
}

/**
 * Score a single candidate move for `player` (higher = better). PURE: consumes
 * no PRNG and never mutates `state`. `-Infinity` means "never pick".
 *
 * - `pass`: a small constant (last resort).
 * - `build`: applied with `applyAction` (builds draw no PRNG, so this is a pure
 *   deterministic transition) and scored by control deltas, with static prunes.
 * - `attack`: scored by EXPECTED value from a HAND-BUILT win-state — we never call
 *   `applyAction`/`resolveCombat` for an attack (that would draw the PRNG, GEO-3).
 */
export function scoreMove(
  state: GameState,
  player: PlayerId,
  move: Action,
  weights: Weights,
): number {
  switch (move.kind) {
    case "pass":
      return 0;
    case "build":
      return scoreBuild(state, player, move, weights);
    case "attack":
      return scoreAttack(state, player, move, weights);
  }
}

function scoreBuild(
  state: GameState,
  player: PlayerId,
  move: Extract<Action, { kind: "build" }>,
  weights: Weights,
): number {
  const { state: next } = applyAction(state, move);

  const before = control(state, player);
  const after = control(next, player);

  const dIron = after.iron.length - before.iron.length;
  const dFact = after.factories.length - before.factories.length;
  const dArea = playerHullArea(next, player) - playerHullArea(state, player);

  let score = weights.iron * dIron + weights.fact * dFact + weights.area * dArea;

  // Prune 1: placing a BASE that brings the player to EXACTLY 4 bases whose
  // resulting perimeter encloses no iron => empty-perimeter self-destruct (R1 /
  // spec §8). Absolute exclusion.
  const placesBase = move.pieces.some((p) => p.type === "base");
  if (placesBase) {
    const basesAfter = next.bases.filter((b) => b.owner === player).length;
    if (basesAfter === PERIMETER_BASE_COUNT && after.iron.length === 0) {
      return -Infinity;
    }
  }

  // Prune 2: dropping a currently-held iron hex is heavily penalized (iron is the
  // victory metric). 1e6 dwarfs any plausible weighted control delta but stays
  // finite so the move can still be the least-bad fallback.
  if (dIron < 0) {
    score -= IRON_DROP_PENALTY;
  }

  // Prune 3: a placed FACTORY whose hex is NOT in the resulting controlled
  // territory is wasted (orphaned, R5). Moderate finite penalty (1e3).
  for (const p of move.pieces) {
    if (p.type === "factory" && !after.hexes.has(key(p.hex))) {
      score -= FACTORY_OUTSIDE_PENALTY;
    }
  }

  return score;
}

function scoreAttack(
  state: GameState,
  player: PlayerId,
  move: Extract<Action, { kind: "attack" }>,
  weights: Weights,
): number {
  // Move-gen emits single-decl attacks (Task 6.2); score the first decl.
  const decl = move.attacks[0]!;
  const commit = decl.attackers.length as 3 | 4 | 5 | 6;
  const pWin = state.config.combatTable[commit];

  // HAND-BUILT win-state (no PRNG, GEO-3): remove the opponent base at `target`;
  // if the acting player has a base in hand, drop a fresh one on the captured hex,
  // else just remove (maxed-out => destroy, mirroring apply.ts).
  const targetKey = key(decl.target);
  let bases: Base[] = state.bases.filter((b) => key(b.hex) !== targetKey);
  if ((state.players[player]?.basesInHand ?? 0) > 0) {
    bases = [
      ...bases,
      { owner: player, hex: decl.target, state: "fresh", order: maxOrder(bases) + 1 },
    ];
  }

  const winState: GameState = { ...state, bases };

  const before = control(state, player);
  const after = control(winState, player);
  const resourcesGained =
    after.iron.length + after.factories.length - (before.iron.length + before.factories.length);

  const combatTerm = pWin * resourcesGained - weights.fatigueCost * commit;
  return weights.aggr * combatTerm;
}
