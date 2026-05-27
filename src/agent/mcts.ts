// ABOUTME: MCTS search core — nodes/edges, max^n N-vector backup, per-acting-player PUCT, progressive-widening expansion, combat chance nodes, determinized turn order.
// ABOUTME: Pure functions threading an explicit search PRNG (no Math.random); uses the engine (applyAction/advanceRound/legalActions) and heuristic samplePolicy as the simulator + candidate generator.

import { applyAction } from "../engine/apply";
import { advanceRound } from "../engine/turn";
import { legalActions } from "../engine/legal";
import { samplePolicy } from "./heuristic";
import { key } from "../geometry/cube";
import { nextFloat, type RngState } from "../rng/pcg";
import type { Action, AttackDecl, Base, GameState, PlayerId } from "../engine/types";

/** Default PUCT exploration constant (`c_puct`). A3.2 may override via params. */
export const defaultCPuct = 1.5;

/**
 * A combat chance node. An `attack` edge does not lead to a single deterministic
 * child — combat is a Bernoulli with `p = combatTable[commit]`. We hold BOTH
 * enumerated outcomes (the deterministic WIN-state and LOSE-state, each built
 * WITHOUT a PRNG draw) and their search subtrees. A simulation that reaches the
 * chance node picks the win subtree with probability `p`, the lose subtree with
 * `1 − p` (drawn from the SEARCH rng); ordinary visit-count averaging then makes
 * the backed-up value converge to the `p`-weighted expectation, so backup does
 * NOT also reweight (that would double-count). `chanceExpectedValue` gives the
 * exact expectation for assertions/leaf eval independent of the sampling.
 */
export interface ChanceNode {
  /** Bernoulli win probability — `config.combatTable[commit]`. */
  readonly p: number;
  /** Win-outcome state, hand-built to mirror apply.ts's attack win-effect. */
  readonly winState: GameState;
  /** Lose-outcome state, hand-built to mirror apply.ts's attack lose-effect. */
  readonly loseState: GameState;
  /** Win subtree (lazily expanded by the search loop in A3.3). */
  win: Node;
  /** Lose subtree (lazily expanded by the search loop in A3.3). */
  lose: Node;
}

/**
 * A per-action edge out of a node. `valueVec` is the per-player accumulated value
 * (an N-vector, one component per player) and `childN` the edge visit count.
 * `child` is filled at expansion time for non-attack actions — undefined for an
 * unexpanded edge. `chance` is filled instead for `attack` actions (combat chance
 * node). `prior` is the policy prior used by `selectChild`'s U term (the
 * `samplePolicy` selection probability for PW edges, a uniform fallback for fixed
 * edges); when absent, `selectChild` falls back to a uniform prior.
 */
export interface Edge {
  readonly action: Action;
  childN: number;
  valueVec: number[];
  prior?: number;
  child?: Node;
  chance?: ChanceNode;
}

/**
 * A search node. Carries its own visit count `N` (scalar) and accumulated
 * per-player value `valueVec` (N-vector), plus the candidate `edges`.
 */
export interface Node {
  N: number;
  valueVec: number[];
  readonly edges: Edge[];
}

/**
 * One step of a selection path: the node visited and the edge chosen out of it.
 * `backup` walks a path of these so it can update both node and edge stats —
 * the node N-vector/visit count and the edge N-vector/visit count are distinct
 * (max^n keeps per-player components independent). This is the documented
 * choice for the spec's `backup(path, leafValueVec)`: the path carries nodes so
 * node-level stats are updated alongside edges.
 */
export interface PathStep {
  readonly node: Node;
  readonly edge: Edge;
}

/** Build a node from candidate actions with zeroed stats for `playerCount` players. */
export function makeNode(actions: Action[], playerCount: number): Node {
  return {
    N: 0,
    valueVec: zeros(playerCount),
    edges: actions.map((action) => ({
      action,
      childN: 0,
      valueVec: zeros(playerCount),
    })),
  };
}

/**
 * max^n backup: add `leafValueVec` componentwise into every edge's `valueVec`
 * (incrementing `childN`) and into every node's `valueVec` (incrementing `N`)
 * along the selection path. The N-vector is per-player so each player's value
 * accumulates independently — this is max^n, NOT negamax (no sign flip per ply).
 */
export function backup(path: PathStep[], leafValueVec: number[]): void {
  for (const { node, edge } of path) {
    node.N += 1;
    addInto(node.valueVec, leafValueVec);
    edge.childN += 1;
    addInto(edge.valueVec, leafValueVec);
  }
}

/**
 * PUCT selection where the ACTING player maximizes their OWN value component —
 * this is what makes the search max^n. For each edge:
 *   Q = edge.valueVec[actingPlayer] / max(1, edge.childN)
 *   U = cPuct * prior * sqrt(node.N) / (1 + edge.childN)
 * The prior is the edge's stored policy prior (`edge.prior`, set at expansion by
 * `expandNode`); when an edge carries no prior (A3.1 hand-built tests), it falls
 * back to a uniform `1 / node.edges.length`. Returns the argmax edge, breaking
 * ties to the lowest edge index (deterministic).
 */
export function selectChild(node: Node, actingPlayer: PlayerId, cPuct: number): Edge {
  const edges = node.edges;
  if (edges.length === 0) {
    throw new Error("selectChild: node has no edges");
  }
  const uniformPrior = 1 / edges.length;
  const sqrtParentN = Math.sqrt(node.N);
  const priorOf = (edge: Edge): number => edge.prior ?? uniformPrior;

  let bestEdge = edges[0]!;
  let bestScore = puctScore(bestEdge, actingPlayer, cPuct, priorOf(bestEdge), sqrtParentN);
  for (let i = 1; i < edges.length; i++) {
    const edge = edges[i]!;
    const score = puctScore(edge, actingPlayer, cPuct, priorOf(edge), sqrtParentN);
    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }
  return bestEdge;
}

function puctScore(
  edge: Edge,
  actingPlayer: PlayerId,
  cPuct: number,
  prior: number,
  sqrtParentN: number,
): number {
  const q = (edge.valueVec[actingPlayer] ?? 0) / Math.max(1, edge.childN);
  const u = (cPuct * prior * sqrtParentN) / (1 + edge.childN);
  return q + u;
}

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

/** Add `src` componentwise into `dst` (mutates `dst`). */
function addInto(dst: number[], src: number[]): void {
  for (let i = 0; i < src.length; i++) {
    dst[i] = (dst[i] ?? 0) + (src[i] ?? 0);
  }
}

// ===========================================================================
// A3.2 — expansion (progressive widening), combat chance nodes, determinized
// turn order.
// ===========================================================================

/** Candidate-generation mode (spec §4.2). */
export type CandidateMode = "pw" | "fixed";

/**
 * Expansion parameters. `C`/`alpha` drive progressive widening (a node opens
 * `k = ceil(C * N^alpha)` children). `temperature` is passed to `samplePolicy`
 * for PW sampling. `candidateMode` selects PW (default) or the small fixed
 * candidate set (the throughput fallback, spec §4.2).
 */
export interface ExpansionParams {
  C: number;
  alpha: number;
  temperature: number;
  candidateMode: CandidateMode;
}

/** PW defaults `C=2, alpha=0.5`, `temperature=1`, `candidateMode="pw"` (spec §4.2). */
export function defaultExpansionParams(): ExpansionParams {
  return { C: 2, alpha: 0.5, temperature: 1, candidateMode: "pw" };
}

/** Progressive-widening child cap for a node with visit count `n`. */
function pwChildCap(n: number, params: ExpansionParams): number {
  return Math.ceil(params.C * Math.pow(n, params.alpha));
}

/**
 * Canonical, order-insensitive key for an action — used to dedupe opened children.
 * Build pieces and attack declarations/attackers are sorted so two actions that
 * differ only in piece/attacker ORDER share a key. Hexes keyed by canonical
 * `"x,y,z"` (GEO-4).
 */
export function actionKey(action: Action): string {
  switch (action.kind) {
    case "pass":
      return "pass";
    case "build": {
      const pieces = action.pieces
        .map((p) => `${p.type}@${key(p.hex)}`)
        .sort()
        .join("|");
      return `build:${pieces}`;
    }
    case "attack": {
      const decls = action.attacks
        .map((d) => {
          const attackers = d.attackers.map(key).sort().join(",");
          return `${key(d.target)}>${attackers}>${key(d.defender)}`;
        })
        .sort()
        .join("|");
      return `attack:${decls}`;
    }
  }
}

/** Max `order` over `bases`, or -1 when empty (mirrors apply.ts / heuristic.ts). */
function maxOrder(bases: Base[]): number {
  let max = -1;
  for (const b of bases) if (b.order > max) max = b.order;
  return max;
}

/**
 * Build the WIN and LOSE outcome states of a single-declaration attack WITHOUT a
 * PRNG draw, mirroring `src/engine/apply.ts`'s `applyOneAttack` EXACTLY so the
 * search simulates the SAME game the driver plays (the load-bearing fidelity
 * property). Construction (see apply.ts step 5/6):
 *  - Both outcomes FATIGUE every committed base (attackers + defender), keyed by
 *    `owner@hex` so two players sharing geometry are never confused.
 *  - WIN: remove the opponent's captured target base; if the acting player has a
 *    base in hand, place a fresh base at the target hex (order = maxOrder+1) and
 *    decrement basesInHand; otherwise destroy with no replacement (maxed out).
 *  - LOSE: only the fatigue change; no base swap, basesInHand unchanged.
 * `rngState` is left UNCHANGED on both — the chance-node sampling (not a combat
 * draw) decides the branch, so the search rng is threaded by `sampleChanceOutcome`,
 * not here. (apply.ts advances rngState via `resolveCombat`; the MCTS layer keeps
 * the game rng untouched by search — A4 threads a separate search rng.)
 */
function attackOutcomes(
  state: GameState,
  player: PlayerId,
  decl: AttackDecl,
): { p: number; winState: GameState; loseState: GameState } {
  const commit = decl.attackers.length as 3 | 4 | 5 | 6;
  const p = state.config.combatTable[commit];

  const targetKey = key(decl.target);
  // The MCTS agent treats every player as solo (spec §2, no alliances), so an
  // "opponent" base is any base not owned by the acting player. apply.ts uses the
  // alliance-aware `!isAlly`, which reduces to `owner !== player` under solo play.
  const targetBase = state.bases.find((b) => key(b.hex) === targetKey && b.owner !== player);
  if (targetBase === undefined) {
    throw new Error(`attackOutcomes: no opponent base at target ${targetKey}`);
  }
  const opponent = targetBase.owner;

  // Committed bases (attackers + defender), keyed by owner@hex (apply.ts step 5).
  const committedKeys = new Set<string>([
    ...decl.attackers.map((h) => `${player}@${key(h)}`),
    `${opponent}@${key(decl.defender)}`,
  ]);
  const fatigued = (bases: Base[]): Base[] =>
    bases.map((b) => (committedKeys.has(`${b.owner}@${key(b.hex)}`) ? { ...b, state: "fatigued" } : b));

  // LOSE: only fatigue (apply.ts: defender wins => no base swap).
  const loseState: GameState = { ...state, bases: fatigued(state.bases) };

  // WIN: fatigue, remove captured target, then replace-or-destroy (apply.ts step 6).
  let winBases = fatigued(state.bases).filter(
    (b) => !(b.owner === opponent && key(b.hex) === targetKey),
  );
  const players = state.players.map((pl) => ({ ...pl }));
  if (players[player]!.basesInHand > 0) {
    winBases = [...winBases, { owner: player, hex: decl.target, state: "fresh", order: maxOrder(winBases) + 1 }];
    players[player]!.basesInHand -= 1;
  }
  const winState: GameState = { ...state, bases: winBases, players };

  return { p, winState, loseState };
}

/**
 * Exact `p`-weighted expectation of two outcome N-vectors: `p·win + (1−p)·lose`
 * componentwise. Verifies the chance-node expectation independently of the
 * sample-per-simulation scheme (which converges to the same value via visit
 * averaging). Pure, no PRNG.
 */
export function chanceExpectedValue(winVec: number[], loseVec: number[], p: number): number[] {
  const n = Math.max(winVec.length, loseVec.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = p * (winVec[i] ?? 0) + (1 - p) * (loseVec[i] ?? 0);
  }
  return out;
}

/**
 * Sample one combat outcome from a chance node, drawing from the SEARCH rng. Picks
 * the win branch with probability `p`, the lose branch with `1−p`. Returns the
 * chosen subtree `node`, its outcome `state`, whether it was the win branch, and
 * the advanced search rng. Visit-count averaging over many simulations converges
 * to `chanceExpectedValue`, so callers MUST NOT additionally reweight in backup.
 */
export function sampleChanceOutcome(
  chance: ChanceNode,
  rng: RngState,
): { node: Node; state: GameState; isWin: boolean; rng: RngState } {
  const { value, state: advanced } = nextFloat(rng);
  const isWin = value < chance.p;
  return {
    node: isWin ? chance.win : chance.lose,
    state: isWin ? chance.winState : chance.loseState,
    isWin,
    rng: advanced,
  };
}

/** A complete legal action plus its policy prior, ready to open as an edge. */
interface Candidate {
  action: Action;
  prior: number;
}

/**
 * The fixed candidate set (spec §4.2 throughput fallback): the greedy
 * (temperature→0) `samplePolicy` build(s), the representative attacks from
 * `legalActions`, and pass (when offered) — deduped by `actionKey`. Bounded and
 * all-legal by construction. Priors are uniform over the produced set (a
 * heuristic prior is the PW path's job; fixed mode trades policy shaping for
 * throughput).
 */
function fixedCandidates(state: GameState, player: PlayerId, rng: RngState): { candidates: Candidate[]; rng: RngState } {
  const seen = new Set<string>();
  const actions: Action[] = [];
  const add = (action: Action): void => {
    const k = actionKey(action);
    if (!seen.has(k)) {
      seen.add(k);
      actions.push(action);
    }
  };

  // Greedy composed action (temperature -> 0). One draw to keep determinism.
  // samplePolicy can THROW on a maxed-out player (basesInHand === 0): legalActions
  // / buildBudget permit a base-build candidate without gating on bases-in-hand, so
  // greedy composition reaches applyAction and rejects the placement. That is a
  // pre-existing defect in the heuristic/engine layer (reported, not fixed here —
  // do-NOT-modify-engine boundary). Guard so MCTS can still expand such nodes from
  // the attacks+pass candidates rather than crashing the whole search.
  let curRng = rng;
  try {
    const greedy = samplePolicy(state, player, curRng, 0);
    curRng = greedy.rng;
    add(greedy.action);
  } catch {
    // Fall through to attacks + pass below; advance the rng once so determinism
    // does not depend on the throwing path's internal draws.
    curRng = nextFloat(curRng).state;
  }

  // Representative attacks from move-gen, and pass when offered.
  for (const a of legalActions(state)) {
    if (a.kind === "attack") add(a);
    if (a.kind === "pass") add(a);
  }

  const prior = actions.length > 0 ? 1 / actions.length : 1;
  return { candidates: actions.map((action) => ({ action, prior })), rng: curRng };
}

/**
 * Expand `node` toward its progressive-widening cap. While the opened-child count
 * is `< k(node.N)` (and the candidate generator can still produce a distinct
 * action), draw a new complete legal action and add it as a fresh zeroed edge:
 *  - `candidateMode "pw"` (default): sample a complete action from
 *    `samplePolicy(state, player, rng, temperature)`; its softmax selection
 *    probability would be the ideal prior, but `samplePolicy` returns only the
 *    chosen action, so we store an EQUAL share `1/k` as a uniform-ish prior (the
 *    learned agent replaces this with the net prior; spec §4.2). Dedupe by
 *    `actionKey`; bounded attempts so a fixture with few distinct actions still
 *    terminates.
 *  - `candidateMode "fixed"`: open the bounded fixed candidate set once (ignores
 *    the PW cap — the set is already small/bounded).
 * Every `attack` edge gets a `ChanceNode` (both outcomes built by `attackOutcomes`
 * WITHOUT a PRNG draw); non-attack edges leave `child` unset (lazily filled by the
 * A3.3 search loop). Threads the search rng (GEO-3). Returns the advanced rng.
 */
export function expandNode(
  node: Node,
  state: GameState,
  player: PlayerId,
  params: ExpansionParams,
  rng: RngState,
): { rng: RngState } {
  const playerCount = state.players.length;
  const opened = new Set<string>(node.edges.map((e) => actionKey(e.action)));
  let curRng = rng;

  const addEdge = (candidate: Candidate): void => {
    const action = candidate.action;
    // Assert every opened child is applyAction-acceptable (fidelity guard).
    applyAction(state, action);
    const edge: Edge = {
      action,
      childN: 0,
      valueVec: zeros(playerCount),
      prior: candidate.prior,
    };
    if (action.kind === "attack" && action.attacks.length === 1) {
      const outcome = attackOutcomes(state, player, action.attacks[0]!);
      edge.chance = {
        p: outcome.p,
        winState: outcome.winState,
        loseState: outcome.loseState,
        win: makeNode([], playerCount),
        lose: makeNode([], playerCount),
      };
    }
    node.edges.push(edge);
    opened.add(actionKey(action));
  };

  if (params.candidateMode === "fixed") {
    const { candidates, rng: r } = fixedCandidates(state, player, curRng);
    curRng = r;
    for (const c of candidates) {
      if (!opened.has(actionKey(c.action))) addEdge(c);
    }
    return { rng: curRng };
  }

  // Progressive widening: open up to k(node.N) distinct children.
  const cap = pwChildCap(node.N, params);
  // Bounded attempts: when the policy keeps re-sampling already-opened actions
  // (a fixture with few distinct candidates), stop after a generous miss budget
  // instead of looping forever.
  const maxAttempts = Math.max(8, cap * 4);
  let attempts = 0;
  while (node.edges.length < cap && attempts < maxAttempts) {
    attempts++;
    // samplePolicy can throw on a maxed-out player (see fixedCandidates note);
    // on a throw, fall back to the bounded fixed candidate set (attacks + pass)
    // so a maxed-out node is still expandable, then stop PW sampling.
    let draw: { action: Action; rng: RngState };
    try {
      draw = samplePolicy(state, player, curRng, params.temperature);
    } catch {
      const fb = fixedCandidates(state, player, curRng);
      curRng = fb.rng;
      for (const c of fb.candidates) {
        if (node.edges.length >= cap) break;
        if (!opened.has(actionKey(c.action))) addEdge(c);
      }
      break;
    }
    curRng = draw.rng;
    const k = actionKey(draw.action);
    if (opened.has(k)) continue;
    // The prior is recomputed below as an equal share once the set is known; use a
    // provisional placeholder and normalize at the end.
    addEdge({ action: draw.action, prior: 1 });
  }

  // Normalize PW priors to an equal share over the opened set (the net-prior
  // version replaces samplePolicy with a learned prior; spec §4.2).
  if (node.edges.length > 0) {
    const share = 1 / node.edges.length;
    for (const edge of node.edges) edge.prior = share;
  }
  return { rng: curRng };
}

/**
 * Advance the simulation one round: apply `action`, then move to the next round
 * via `advanceRound` with the TURN-ROLLOVER draw determinized by the SEARCH rng.
 * `advanceRound` reads `state.rngState` for the rollover order shuffle; to keep
 * the search deterministic given its own seed (and to NOT consume the game's main
 * PRNG with search draws, per the global do-NOT), we splice the search rng into
 * the state just for the `advanceRound` call, then thread the advanced rng back
 * out. Intra-turn steps consume no randomness (advanceRound only bumps the index),
 * so the search rng passes through unchanged in that case.
 *
 * NOTE: `applyAction` for an `attack` would itself draw the game PRNG via
 * `resolveCombat`; the MCTS search avoids that path entirely by modeling combat as
 * a chance node (see `attackOutcomes`/`sampleChanceOutcome`), so `simulateStep` is
 * used for the non-combat transitions and the post-action round advance.
 */
export function simulateStep(
  state: GameState,
  action: Action,
  searchRng: RngState,
): { state: GameState; rng: RngState } {
  const afterAction = applyAction(state, action).state;
  // Splice the search rng in so advanceRound's rollover draw is determinized by
  // the search seed rather than the game's main stream.
  const advanced = advanceRound({ ...afterAction, rngState: searchRng });
  return { state: advanced, rng: advanced.rngState };
}
