// ABOUTME: Perimeter-aware position evaluator — evaluate(state) returns a per-player score vector for MCTS leaf eval.
// ABOUTME: Pure; recomputes control/hull every call (GEO-5), keys hex membership by canonical string (GEO-4), no PRNG.

import { control } from "../engine/control";
import { key, neighbors } from "../geometry/cube";
import { convexHull, hullArea } from "../geometry/hull";
import type { GameState, Hex, PlayerId } from "../engine/types";

const PERIMETER_BASE_COUNT = 4;

/** Sentinel score for an eliminated player — far below any live score. */
const ELIMINATED_SCORE = -1e9;

/**
 * Feature weights for `evaluate`. Each multiplies one position feature; the
 * weighted sum is a player's score. These are a robustness-check dimension
 * (the design varies them across MCTS configs), so they are passed in, not baked in.
 */
export interface HeuristicWeights {
  iron: number;
  fact: number;
  area: number;
  tempo: number;
  perimeter: number;
  frontier: number;
}

/**
 * Default weights. Rationale:
 *  - `iron: 10` DOMINATES — controlled iron is the victory metric, so every
 *    other feature is a tie-breaker / shaping term beneath it.
 *  - `fact: 1` — factories add production and deny the shared pool, but one
 *    factory is worth far less than one iron.
 *  - `area: 1` — perimeter area is a weak proxy for board presence; kept small
 *    so it never overrides iron.
 *  - `tempo: 0.5` — fresh bases are optionality, valued modestly.
 *  - `perimeter: 4` — the ANTI-MYOPIA term. Establishing a valid iron-enclosing
 *    4-base perimeter is worth ~0.4 iron of standing reward, enough to make a
 *    perimeter-forming position outrank a flat one at equal controlled iron
 *    (the M1 greedy agent's 4th-base myopia fix).
 *  - `frontier: 0.5` — a per-exposed-border-hex penalty; small so a single
 *    contested hex doesn't dominate, but enough that compact positions are
 *    preferred over sprawling exposed ones.
 */
export function defaultHeuristicWeights(): HeuristicWeights {
  return { iron: 10, fact: 1, area: 1, tempo: 0.5, perimeter: 4, frontier: 0.5 };
}

/** The player's base hexes (for hull/area features). */
function baseHexesOf(state: GameState, player: PlayerId): Hex[] {
  return state.bases.filter((b) => b.owner === player).map((b) => b.hex);
}

/**
 * Super-linear distance-to-threshold bonus on controlled iron. Beyond the linear
 * `iron * weight` term, a player gets EXTRA reward as their controlled iron
 * approaches `victoryThreshold`, because the last few iron win the game.
 *
 * Shape (documented choice): a quadratic ramp over the final two iron below the
 * threshold. Let `gap = threshold - ironCount` (clamped at >= 0). The bonus is
 *   `weight * max(0, 2 - gap)^2`
 * so it is 0 when more than 2 short of the threshold, `weight` at gap==1
 * (threshold-1), `4*weight` at gap==0 (already at/over threshold), and grows
 * super-linearly as the gap closes. This makes a player at threshold-1 score
 * strictly more than (linear iron of) one extra iron over a player at
 * threshold-3 would predict.
 */
function thresholdBonus(ironCount: number, threshold: number, weight: number): number {
  const gap = Math.max(0, threshold - ironCount);
  const closeness = Math.max(0, 2 - gap);
  return weight * closeness * closeness;
}

/**
 * Score one player. Weighted sum of:
 *  - iron: controlled-iron count (dominant) + a super-linear threshold bonus.
 *  - fact: controlled-factory count.
 *  - area: hull area over the player's base centers (0 if <4 bases or degenerate).
 *  - tempo: count of the player's fresh bases.
 *  - perimeter: a flat reward IFF the player holds a VALID 4-base perimeter
 *    (>=4 bases, non-degenerate hull) that encloses >=1 controlled iron — the
 *    anti-myopia term.
 *  - frontier: a PENALTY per controlled hex adjacent to an opponent-controlled
 *    hex (exposed border).
 *
 * All hex membership keyed by canonical string (GEO-4); control/hull recomputed
 * here, never cached (GEO-5).
 */
function scorePlayer(state: GameState, player: PlayerId, w: HeuristicWeights): number {
  const ctl = control(state, player);

  // iron: linear + super-linear threshold bonus.
  let score = w.iron * ctl.iron.length;
  score += thresholdBonus(ctl.iron.length, state.config.victoryThreshold, w.iron);

  // factories.
  score += w.fact * ctl.factories.length;

  // perimeter area over base centers.
  const baseHexes = baseHexesOf(state, player);
  const hull = baseHexes.length >= 3 ? convexHull(baseHexes) : [];
  const area = hullArea(hull);
  score += w.area * area;

  // tempo: fresh bases.
  const freshCount = state.bases.filter((b) => b.owner === player && b.state === "fresh").length;
  score += w.tempo * freshCount;

  // perimeter establishment: valid 4-base non-degenerate hull enclosing >=1 iron.
  const hasValidPerimeter =
    baseHexes.length >= PERIMETER_BASE_COUNT && area > 0 && ctl.iron.length >= 1;
  if (hasValidPerimeter) {
    score += w.perimeter;
  }

  // frontier exposure: count my controlled hexes adjacent to any (live) opponent's
  // controlled hex. Build the union of opponents' controlled hexes once, then test
  // each of my hexes' neighbors against it (GEO-4 keyed).
  const opponentHexes = new Set<string>();
  for (const opp of state.players) {
    if (opp.id === player) continue;
    if (opp.eliminated) continue;
    for (const k of control(state, opp.id).hexes) opponentHexes.add(k);
  }
  let exposed = 0;
  for (const k of ctl.hexes) {
    const [x, y, z] = k.split(",").map(Number) as [number, number, number];
    for (const n of neighbors({ x, y, z })) {
      if (opponentHexes.has(key(n))) {
        exposed++;
        break; // count each of MY hexes at most once
      }
    }
  }
  score -= w.frontier * exposed;

  return score;
}

/**
 * Position evaluation: one score per player, indexed by player id. Higher is
 * better for that player. Eliminated players get a sentinel far below any live
 * score (`-1e9`). Pure — recomputes control/hull each call (GEO-5), no PRNG.
 */
export function evaluate(state: GameState, weights: HeuristicWeights = defaultHeuristicWeights()): number[] {
  return state.players.map((p) =>
    p.eliminated ? ELIMINATED_SCORE : scorePlayer(state, p.id, weights),
  );
}
