// ABOUTME: Greedy-weighted archetype agent — chooseAction (softmax, greedy multi-placement, defensive reserve).
// ABOUTME: PURE: reads state.rngState, returns the action plus a state whose rng is advanced by the softmax draw.

import { applyAction } from "../engine/apply";
import { buildBudget } from "../engine/build";
import { legalActions } from "../engine/legal";
import { distance } from "../geometry/cube";
import { nextFloat } from "../rng/pcg";
import { preset, type Archetype } from "./archetypes";
import { scoreMove, type Weights } from "./score";
import type { Action, GameState, PlayerId } from "../engine/types";

export type { Archetype };

const RESERVE_THREAT_COUNT = 3;

/**
 * True iff some opponent (owner NOT in `player`'s alliance) has at least 3 FRESH
 * bases within `config.attackRange` cube-distance of ANY of `player`'s bases.
 * This is the defensive-reserve trigger: an enemy that close in that number can
 * mount a 3+ attack on the frontier, so the agent should not over-commit.
 */
export function isThreatened(state: GameState, player: PlayerId): boolean {
  const alliance = state.players[player]!.alliance;
  const isAlly = (id: PlayerId): boolean => alliance.includes(id);
  const range = state.config.attackRange;

  const myBases = state.bases.filter((b) => b.owner === player);
  if (myBases.length === 0) return false;

  // Tally, per opponent, how many of their fresh bases sit within range of ANY
  // of my bases. >=3 from a single opponent means a viable attack force.
  const freshNearByOpponent = new Map<PlayerId, number>();
  for (const opp of state.bases) {
    if (isAlly(opp.owner)) continue;
    if (opp.state !== "fresh") continue;
    if (myBases.some((mine) => distance(opp.hex, mine.hex) <= range)) {
      freshNearByOpponent.set(opp.owner, (freshNearByOpponent.get(opp.owner) ?? 0) + 1);
    }
  }

  for (const count of freshNearByOpponent.values()) {
    if (count >= RESERVE_THREAT_COUNT) return true;
  }
  return false;
}

/**
 * Greedily compose a single-type multi-piece build for `player`, capped at the
 * build budget so `applyAction` always accepts it. Repeatedly: among legal
 * single-piece builds of type `type` on the CURRENT working state, pick the
 * highest-scoring; if none exists or its score is <= 0 (or -Infinity), stop;
 * otherwise append its piece, advance the working state (builds draw no PRNG),
 * and continue. Returns the composed build action, or null when no piece placed.
 */
function composeBuild(
  state: GameState,
  player: PlayerId,
  type: "factory" | "base",
  weights: Weights,
): Extract<Action, { kind: "build" }> | null {
  const budget = buildBudget(state, player);
  if (budget < 1) return null;

  let cur = state;
  const pieces: { type: "factory" | "base"; hex: GameState["board"]["hexes"][number] }[] = [];

  for (let i = 0; i < budget; i++) {
    // Single-piece builds of THIS type that are legal on the current working state.
    const singles = legalActions(cur).filter(
      (a): a is Extract<Action, { kind: "build" }> =>
        a.kind === "build" && a.pieces.length === 1 && a.pieces[0]!.type === type,
    );

    let best: Extract<Action, { kind: "build" }> | null = null;
    let bestScore = -Infinity;
    for (const single of singles) {
      const s = scoreMove(cur, player, single, weights);
      if (s > bestScore) {
        bestScore = s;
        best = single;
      }
    }

    // Stop when nothing legal remains or the best single is not a net gain.
    if (best === null || bestScore <= 0) break;

    pieces.push(best.pieces[0]!);
    cur = applyAction(cur, best).state;
  }

  if (pieces.length < 1) return null;
  return { kind: "build", pieces };
}

/**
 * Choose an action for `player` (the current player passed by the driver). PURE:
 * reads `state.rngState`, returns the chosen action plus a NEW state whose
 * `rngState` is advanced by the single softmax draw (same in-`state` rng pattern
 * as `applyAction`; the driver threads the returned state into the next
 * `applyAction`).
 *
 * Pipeline (roadmap Part 1):
 *  1. Resolve archetype preset (weights + temperature).
 *  2. Compose a greedy multi-piece build per type (factory, base), each capped at
 *     the build budget so it is guaranteed legal.
 *  3. Filter attacks by the defensive-reserve rule, then keep the best by score.
 *  4. Build the option set, drop -Infinity options, and softmax-sample one option
 *     using the PRNG. Always returns an action `applyAction` accepts.
 */
export function chooseAction(
  state: GameState,
  player: PlayerId,
  archetype: Archetype,
): { action: Action; state: GameState } {
  const { weights, temperature } = preset(archetype);
  const acts = legalActions(state);

  type Option = { action: Action; score: number };
  const options: Option[] = [];

  // 2. Greedy multi-piece builds, one per type.
  const factoryBuild = composeBuild(state, player, "factory", weights);
  if (factoryBuild !== null) {
    options.push({ action: factoryBuild, score: scoreMove(state, player, factoryBuild, weights) });
  }
  const baseBuild = composeBuild(state, player, "base", weights);
  if (baseBuild !== null) {
    options.push({ action: baseBuild, score: scoreMove(state, player, baseBuild, weights) });
  }

  // 3. Attacks with defensive-reserve filtering.
  const attacks = acts.filter((a): a is Extract<Action, { kind: "attack" }> => a.kind === "attack");
  const threatened = isThreatened(state, player);
  const myFreshCount = state.bases.filter((b) => b.owner === player && b.state === "fresh").length;

  let bestAttack: Extract<Action, { kind: "attack" }> | null = null;
  let bestAttackScore = -Infinity;
  for (const atk of attacks) {
    // Defensive reserve: never commit ALL of your fresh bases when threatened —
    // keep >=1 fresh in reserve. (Attackers come from the acting player's bases;
    // committing >= myFreshCount would leave no fresh reserve.)
    if (threatened) {
      const committed = atk.attacks.reduce((n, d) => n + d.attackers.length, 0);
      if (committed >= myFreshCount) continue;
    }
    const s = scoreMove(state, player, atk, weights);
    if (s > bestAttackScore) {
      bestAttackScore = s;
      bestAttack = atk;
    }
  }
  if (bestAttack !== null) {
    options.push({ action: bestAttack, score: bestAttackScore });
  }

  // pass, when present.
  const pass = acts.find((a) => a.kind === "pass");
  if (pass !== undefined) {
    options.push({ action: pass, score: scoreMove(state, player, pass, weights) });
  }

  // Drop never-pick (-Infinity) options.
  let usable = options.filter((o) => o.score > -Infinity);

  // Fallback: if the curated set is empty, prefer pass, else the highest-scoring
  // raw legal action (there is always at least one legal action).
  if (usable.length === 0) {
    if (pass !== undefined) {
      usable = [{ action: pass, score: 0 }];
    } else {
      let best = acts[0]!;
      let bestScore = scoreMove(state, player, best, weights);
      for (const a of acts) {
        const s = scoreMove(state, player, a, weights);
        if (s > bestScore) {
          bestScore = s;
          best = a;
        }
      }
      usable = [{ action: best, score: bestScore }];
    }
  }

  // 4. Softmax-sample one option. Subtract max for numerical stability.
  const maxS = usable.reduce((m, o) => (o.score > m ? o.score : m), -Infinity);
  const exps = usable.map((o) => Math.exp((o.score - maxS) / temperature));
  const total = exps.reduce((a, b) => a + b, 0);

  const { value: r, state: advancedRng } = nextFloat(state.rngState);

  // If total is non-finite/zero (degenerate), fall back to argmax (the first
  // usable option after the stable subtraction has the max).
  let chosen: Action;
  if (!(total > 0) || !Number.isFinite(total)) {
    chosen = usable[0]!.action;
  } else {
    const threshold = r * total;
    let cum = 0;
    chosen = usable[usable.length - 1]!.action; // guard against fp drift at the tail
    for (let i = 0; i < usable.length; i++) {
      cum += exps[i]!;
      if (threshold < cum) {
        chosen = usable[i]!.action;
        break;
      }
    }
  }

  return { action: chosen, state: { ...state, rngState: advancedRng } };
}
