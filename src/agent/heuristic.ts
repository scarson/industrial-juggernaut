// ABOUTME: Perimeter-aware position evaluator — evaluate(state) returns a per-player score vector for MCTS leaf eval.
// ABOUTME: Pure; recomputes control/hull every call (GEO-5), keys hex membership by canonical string (GEO-4), no PRNG.

import { applyAction } from "../engine/apply";
import { buildBudget } from "../engine/build";
import { control } from "../engine/control";
import { legalActions } from "../engine/legal";
import { key, neighbors } from "../geometry/cube";
import { convexHull, hullArea } from "../geometry/hull";
import { nextFloat, type RngState } from "../rng/pcg";
import { scoreMove, type Weights } from "./score";
import type { Action, Base, GameState, Hex, PlayerId } from "../engine/types";

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
  survival: number;
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
 *  - `survival: 12` — the ANTI-SELF-DESTRUCT term. A myopic per-move agent that
 *    only sees factory/perimeter REWARD will compose factory builds that push its
 *    controlled-factory count to/over `brokenPerimeterDeathAtFactories` while
 *    still holding <4 bases, tripping the `brokenPerimeterAt18Factories`
 *    elimination. This per-extra-factory ramp penalty (in the no-perimeter regime
 *    only) outweighs `fact`'s per-factory reward inside the danger band, so the
 *    agent stops adding factories and pivots to base-building before the clock
 *    fires. See `survivalPenalty` for the exact shape; calibrated empirically via
 *    `measureDistribution` 2P self-play (drives self-destructs to ~0 while keeping
 *    factories valuable once a 4-base perimeter is established).
 */
export function defaultHeuristicWeights(): HeuristicWeights {
  return { iron: 10, fact: 1, area: 1, tempo: 0.5, perimeter: 4, frontier: 0.5, survival: 12 };
}

/**
 * Width (in factories) of the danger band below the factory-death threshold over
 * which the survival penalty ramps up. With `RAMP_WIDTH = 2` the penalty is 0
 * when a <4-base player controls `threshold-2` or fewer factories, then ramps for
 * the last two factories before the threshold and goes severe at/over it.
 */
const RAMP_WIDTH = 2;

/**
 * Penalty for a player sitting near/at the per-player factory-death condition.
 *
 * The death rule (`applyEliminations`, `brokenPerimeterAt18Factories`) eliminates
 * a player with `< PERIMETER_BASE_COUNT` bases once it controls `>= threshold`
 * factories. So the penalty applies ONLY in the no-perimeter regime
 * (`baseCount < PERIMETER_BASE_COUNT`); with an established 4-base perimeter the
 * death rule cannot fire and factories are pure value (penalty 0).
 *
 * Shape, given `f = controlled factories`, `threshold = brokenPerimeterDeathAtFactories`:
 *  - `f >= threshold`: the player is AT the literal elimination condition — the
 *    very next `applyEliminations` removes it. Return the eliminated sentinel
 *    (`-ELIMINATED_SCORE` so the caller subtracts it), so the position scores
 *    ~as-bad-as-eliminated and the agent never chooses to enter it.
 *  - `threshold - RAMP_WIDTH <= f < threshold`: a linear ramp,
 *    `weight * (f - (threshold - RAMP_WIDTH))`, i.e. 0 at `threshold-RAMP_WIDTH`,
 *    rising to `weight*(RAMP_WIDTH-1)` at `threshold-1`. With `weight > fact` this
 *    band's marginal penalty exceeds `fact`'s marginal reward, so each extra
 *    factory inside the band is net-negative and the agent pivots to bases.
 *  - `f < threshold - RAMP_WIDTH`: no penalty (0) — factories are safely below the clock.
 */
function survivalPenalty(baseCount: number, factoryCount: number, threshold: number, weight: number): number {
  if (baseCount >= PERIMETER_BASE_COUNT) return 0;
  if (factoryCount >= threshold) return -ELIMINATED_SCORE;
  const bandStart = threshold - RAMP_WIDTH;
  if (factoryCount <= bandStart) return 0;
  return weight * (factoryCount - bandStart);
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

  // survival: penalize the imminent industry-without-territory death (a <4-base
  // player at/approaching the per-player factory-death threshold). Keyed on base
  // COUNT (not a valid-hull perimeter) to match the elimination rule's own gate.
  score -= survivalPenalty(
    baseHexes.length,
    ctl.factories.length,
    state.config.brokenPerimeterDeathAtFactories,
    w.survival,
  );

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

// ---------------------------------------------------------------------------
// Stochastic action policy (samplePolicy) — spec §4.1.
// ---------------------------------------------------------------------------

const MIN_TEMPERATURE = 1e-9;

/**
 * Per-piece move-scoring weights used WITHIN samplePolicy to rank the single
 * placements that make up a build, and to rank representative attacks. These are
 * the score.ts `Weights` (control-delta + expected-attack scorer), NOT the
 * position-evaluation `HeuristicWeights` above — the two scorers measure
 * different things (per-move delta vs. absolute position). We keep an
 * iron-dominant preset consistent with the M1 archetypes (`iron: 10`): iron is
 * the victory metric, so no other per-piece term may outweigh it.
 */
const POLICY_MOVE_WEIGHTS: Weights = { iron: 10, fact: 1, area: 1, aggr: 1, fatigueCost: 0.1 };

/**
 * Default per-iron bonus applied to an ally candidate's typeValue when scoring
 * potential alliance partners (`samplePolicy`). Tunable via `samplePolicy`'s
 * `policyOpts.allianceWeight` (and threaded through `heuristicAgent`'s
 * `allianceWeight` param) so a sweep can tune it.
 *
 * Symmetric `DEFAULT_BREAK_ALLIANCE_WEIGHT` penalizes breaking off a strong
 * partner — per-iron PENALTY on the ally's controlled iron when scoring a
 * `break-alliance` candidate. Also tunable.
 */
export const DEFAULT_POLICY_ALLIANCE_WEIGHT = 5;
export const DEFAULT_POLICY_BREAK_ALLIANCE_WEIGHT = 5;

/** Optional tuning knobs for `samplePolicy` that are policy-scoped (not part of `evaluate`'s weights). */
export interface PolicyOpts {
  allianceWeight?: number;
  breakAllianceWeight?: number;
}

/** Max `order` over every base, or -1 when there are none (mirrors apply.ts / score.ts). */
function maxOrder(bases: Base[]): number {
  let max = -1;
  for (const b of bases) if (b.order > max) max = b.order;
  return max;
}

/**
 * Softmax-sample one index from `scores`, threading the PRNG. Subtracts the max
 * before exponentiating (numerical stability) and clamps temperature to
 * `MIN_TEMPERATURE` so a near-zero temperature drives the distribution to the
 * argmax (the deterministic greedy limit) instead of dividing by zero.
 *
 * `-Infinity` scores are never-pick: their weight is forced to 0. If every score
 * is `-Infinity` (or the weights underflow to a non-finite/zero total), we fall
 * back to the argmax index (the first max after the stable subtraction), so the
 * draw is still deterministic. Returns the chosen index and the advanced rng.
 */
function softmaxSample(scores: number[], temperature: number, rng: RngState): { index: number; rng: RngState } {
  const t = Math.max(temperature, MIN_TEMPERATURE);

  let maxS = -Infinity;
  let argmax = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]! > maxS) {
      maxS = scores[i]!;
      argmax = i;
    }
  }

  const exps = scores.map((s) => (s === -Infinity ? 0 : Math.exp((s - maxS) / t)));
  const total = exps.reduce((a, b) => a + b, 0);

  const { value: r, state: advancedRng } = nextFloat(rng);

  if (!(total > 0) || !Number.isFinite(total)) {
    return { index: argmax, rng: advancedRng };
  }

  // Greedy (temperature -> 0) limit: when every sub-max score has underflowed to
  // weight 0, only ties AT the max remain. A uniform draw among ties would be
  // seed-dependent, breaking the "temperature -> 0 == greedy composer" property; so
  // resolve ties deterministically to the FIRST max index (matching greedy.ts's
  // first-wins argmax tie-break).
  let onlyMaxSurvives = true;
  for (let i = 0; i < scores.length; i++) {
    if (exps[i]! > 0 && scores[i]! !== maxS) {
      onlyMaxSurvives = false;
      break;
    }
  }
  if (onlyMaxSurvives) {
    return { index: argmax, rng: advancedRng };
  }

  const threshold = r * total;
  let cum = 0;
  // Default to the last index, guarding against floating-point drift at the tail.
  let index = scores.length - 1;
  for (let i = 0; i < scores.length; i++) {
    cum += exps[i]!;
    if (threshold < cum) {
      index = i;
      break;
    }
  }
  return { index, rng: advancedRng };
}

/** Single-piece build actions of `type` legal on `state` for the current player. */
function legalSinglePieceBuilds(state: GameState, type: "factory" | "base"): Extract<Action, { kind: "build" }>[] {
  return legalActions(state).filter(
    (a): a is Extract<Action, { kind: "build" }> =>
      a.kind === "build" && a.pieces.length === 1 && a.pieces[0]!.type === type,
  );
}

/**
 * Compose a multi-piece, single-type build by sampling placements one at a time,
 * weighted by `softmax(perPieceScore / temperature)` over the legal single
 * placements of `type` on the PROGRESSIVELY-built hypothetical state. Each pick is
 * applied via `applyAction` (builds draw no PRNG) so later placements see the
 * reshaped perimeter/occupancy, capped at `buildBudget(state, player)` pieces.
 * Stops early when no legal placement remains. Threads `rng` through every draw
 * (GEO-3). Returns the composed build (or null if no piece could be placed) and
 * the advanced rng.
 *
 * At temperature -> 0 each draw becomes the argmax, so this reduces to the
 * deterministic greedy composer in greedy.ts.
 */
function sampleBuild(
  state: GameState,
  player: PlayerId,
  type: "factory" | "base",
  temperature: number,
  rng: RngState,
): { build: Extract<Action, { kind: "build" }> | null; rng: RngState } {
  const budget = buildBudget(state, player);
  if (budget < 1) return { build: null, rng };

  let cur = state;
  let curRng = rng;
  const pieces: { type: "factory" | "base"; hex: Hex }[] = [];

  for (let i = 0; i < budget; i++) {
    const singles = legalSinglePieceBuilds(cur, type);
    if (singles.length === 0) break;

    const scores = singles.map((s) => scoreMove(cur, player, s, POLICY_MOVE_WEIGHTS));
    const draw = softmaxSample(scores, temperature, curRng);
    curRng = draw.rng;

    const chosen = singles[draw.index]!;
    pieces.push(chosen.pieces[0]!);
    cur = applyAction(cur, chosen).state;
  }

  if (pieces.length < 1) return { build: null, rng: curRng };
  return { build: { kind: "build", pieces }, rng: curRng };
}

/** Representative attack actions for the current player from move-gen. */
function legalAttacks(state: GameState): Extract<Action, { kind: "attack" }>[] {
  return legalActions(state).filter((a): a is Extract<Action, { kind: "attack" }> => a.kind === "attack");
}

/**
 * Sample one representative attack, weighted by `softmax(scoreMove / temperature)`
 * over the attacks `legalActions` emits. Threads `rng`. Returns null when there
 * are no attacks.
 */
function sampleAttack(
  state: GameState,
  player: PlayerId,
  temperature: number,
  rng: RngState,
): { attack: Extract<Action, { kind: "attack" }> | null; rng: RngState } {
  const attacks = legalAttacks(state);
  if (attacks.length === 0) return { attack: null, rng };

  const scores = attacks.map((a) => scoreMove(state, player, a, POLICY_MOVE_WEIGHTS));
  const draw = softmaxSample(scores, temperature, rng);
  return { attack: attacks[draw.index]!, rng: draw.rng };
}

/**
 * Expected position value (on the `evaluate` scale) of an attack instance for
 * `player`, computed WITHOUT a PRNG draw (GEO-3): the `p`-weighted mix of the
 * hand-built win-state and the lose-state, mirroring score.ts's hand-built
 * win-state. On a win we remove the captured target base and, if the player has a
 * base in hand, drop a fresh one on the captured hex (else just remove — maxed-out
 * destroy). On a loss the board is unchanged. (Fatigue of committed bases is not
 * applied to either branch — a documented simplification; `evaluate`'s tempo term
 * would otherwise need both branches fatigued, which is more machinery than this
 * type-value comparison needs.)
 */
function attackTypeValue(state: GameState, player: PlayerId, attack: Extract<Action, { kind: "attack" }>): number {
  const decl = attack.attacks[0]!;
  const commit = decl.attackers.length as 3 | 4 | 5 | 6;
  const pWin = state.config.combatTable[commit];

  const targetKey = key(decl.target);
  let bases: Base[] = state.bases.filter((b) => key(b.hex) !== targetKey);
  if ((state.players[player]?.basesInHand ?? 0) > 0) {
    bases = [...bases, { owner: player, hex: decl.target, state: "fresh", order: maxOrder(bases) + 1 }];
  }
  const winState: GameState = { ...state, bases };

  const winValue = evaluate(winState)[player]!;
  const loseValue = evaluate(state)[player]!;
  return pWin * winValue + (1 - pWin) * loseValue;
}

/**
 * Stochastic, heuristic-guided complete-action policy (spec §4.1). PURE: threads
 * `rng` through every draw (GEO-3); no `Math.random`. Reused as the MCTS
 * rollout/default policy AND the progressive-widening candidate generator.
 *
 * Algorithm:
 *  1. Sample one concrete COMPLETE action of each available round-type:
 *     - factory-build / base-build: a multi-piece build composed by sampling
 *       placements proportional to their per-piece `scoreMove` (see `sampleBuild`).
 *     - attack: a representative attack sampled proportional to its `scoreMove`.
 *     - pass: the pass action, when `legalActions` offers it.
 *  2. Choose the round-type by softmax over each sampled instance's TYPE VALUE —
 *     the heuristic position value for `player`. Build/pass type values are
 *     `evaluate(applyAction(state, instance).state)[player]`; the attack type value
 *     is the PRNG-free expected `evaluate` over win/lose (see `attackTypeValue`),
 *     keeping every type value on the same `evaluate` scale (mixing an absolute
 *     `evaluate` with a delta-scale `scoreMove` would make attacks unsamplable).
 *
 * At temperature -> 0 every softmax (per-piece and round-type) collapses to argmax,
 * so samplePolicy reduces to the deterministic greedy composer — giving the
 * "fixed candidate set" throughput fallback for free.
 */
export function samplePolicy(
  state: GameState,
  player: PlayerId,
  rng: RngState,
  temperature: number,
  policyOpts?: PolicyOpts,
): { action: Action; rng: RngState } {
  const allianceWeight = policyOpts?.allianceWeight ?? DEFAULT_POLICY_ALLIANCE_WEIGHT;
  const breakAllianceWeight = policyOpts?.breakAllianceWeight ?? DEFAULT_POLICY_BREAK_ALLIANCE_WEIGHT;
  let curRng = rng;

  type Candidate = { action: Action; typeValue: number };
  const candidates: Candidate[] = [];

  // 1a. Builds, one composed instance per type.
  for (const type of ["factory", "base"] as const) {
    const { build, rng: r } = sampleBuild(state, player, type, temperature, curRng);
    curRng = r;
    if (build !== null) {
      const typeValue = evaluate(applyAction(state, build).state)[player]!;
      candidates.push({ action: build, typeValue });
    }
  }

  // 1b. Attack, one representative instance.
  const { attack, rng: rAttack } = sampleAttack(state, player, temperature, curRng);
  curRng = rAttack;
  if (attack !== null) {
    candidates.push({ action: attack, typeValue: attackTypeValue(state, player, attack) });
  }

  // 1c. Pass, when offered. applyAction(pass) leaves the state unchanged.
  const acts = legalActions(state);
  const pass = acts.find((a) => a.kind === "pass");
  if (pass !== undefined) {
    candidates.push({ action: pass, typeValue: evaluate(state)[player]! });
  }

  // 1d. Alliance actions — one candidate per legal ally / break-alliance target. Gated by
  // engine state (alliancesEnabled, cooldown, basesInHand, existing alliance set); we delegate
  // the gating to `legalActions` rather than re-implement it here to avoid drift. Scoring:
  //  - ally(T): `evaluate(post-apply)[player] + POLICY_ALLIANCE_WEIGHT × control(state, T).iron`
  //    — prefers strong partners (more iron = more coalition progress). `applyAction(ally)` is
  //    pure (no rng draw), so we compute the post-state directly without threading the rng.
  //  - break-alliance(T): `evaluate(state)[player] − POLICY_BREAK_ALLIANCE_WEIGHT × control(state, T).iron`
  //    — penalizes breaking off a strong ally. We score against the UNCHANGED state because
  //    `applyAction(break-alliance)` draws a coin flip (2/3 success), and we don't want to burn
  //    rng inside the scorer; the unchanged-state evaluate is the success branch's near-equivalent
  //    for the actor's own evaluate (alliance arrays don't affect controlled iron/factories).
  for (const a of acts) {
    if (a.kind === "ally") {
      const post = applyAction(state, a).state;
      const targetIron = control(state, a.target).iron.length;
      const typeValue = evaluate(post)[player]! + allianceWeight * targetIron;
      candidates.push({ action: a, typeValue });
    } else if (a.kind === "break-alliance") {
      const allyIron = control(state, a.target).iron.length;
      const typeValue = evaluate(state)[player]! - breakAllianceWeight * allyIron;
      candidates.push({ action: a, typeValue });
    }
  }

  // Fallback: legalActions normally yields >= 1 action, so `candidates` would only be
  // empty if every build composition failed AND there was no attack AND no pass. With
  // the variant-(a)/(c) `noIronRequiresPerimeter` flag (stranded radiating players)
  // and certain maxed-out late-game states with `allowPass: false`, this CAN now
  // happen. Previously the `acts[0]!` access silently returned `{action: undefined}`
  // and propagated the undefined into the engine; now we throw a CLEAR diagnostic
  // for the caller to record (parallel to the chooseActionMCTS guard).
  if (candidates.length === 0) {
    if (acts.length === 0) {
      throw new Error(
        `heuristic samplePolicy: no legal action available for player ${player} at turn ${state.phase.turn} ` +
          `(no builds/attacks/pass — likely a stranded radiating player under noIronRequiresPerimeter, ` +
          `or a maxed-out late-game state with allowPass=false).`,
      );
    }
    return { action: acts[0]!, rng: nextFloat(curRng).state };
  }

  // 2. Choose the round-type by softmax over type values.
  const draw = softmaxSample(candidates.map((c) => c.typeValue), temperature, curRng);
  return { action: candidates[draw.index]!.action, rng: draw.rng };
}
