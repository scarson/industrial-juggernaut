// ABOUTME: Turn/round orchestration — game setup, current-player lookup, and round/turn advancement.
// ABOUTME: All functions are PURE: they return new state and thread `rngState` forward per GEO-3 (no Math.random).

import { key } from "../geometry/cube";
import { ringDepthFromEdge } from "../board/shape";
import { control } from "./control";
import { nextInt } from "../rng/pcg";
import type { RuleConfig } from "./config";
import type {
  Base,
  Board,
  GameState,
  Hex,
  Player,
  PlayerId,
  RngState,
} from "./types";

/**
 * Fisher–Yates shuffle over `items`, threading the PRNG state per GEO-3.
 * Returns a NEW array (input untouched) and the advanced rng state.
 */
function shuffle<T>(rng: RngState, items: readonly T[]): { result: T[]; rng: RngState } {
  const arr = items.slice();
  let state = rng;
  for (let i = arr.length - 1; i > 0; i--) {
    const draw = nextInt(state, i + 1);
    state = draw.state;
    const j = draw.value;
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return { result: arr, rng: state };
}

// nextInt returns { value, state }; normalize the field name we thread on.
function nextIntT(rng: RngState, n: number): { value: number; rng: RngState } {
  const r = nextInt(rng, n);
  return { value: r.value, rng: r.state };
}

/**
 * Project a hex onto a 2D plane and return its angle around the board centre.
 * Used to seat starting bases evenly around the outer ring. `px`/`py` are the
 * standard pointy-top axial→pixel transform (unit size); the absolute scale is
 * irrelevant since we only sort by angle.
 */
function hexAngle(h: { x: number; z: number }): number {
  const px = Math.sqrt(3) * (h.x + h.z / 2);
  const py = 1.5 * h.z;
  return Math.atan2(py, px);
}

/** Outer-ring hexes (ringDepthFromEdge === 0), sorted by projected angle then key. */
function outerRingSorted(board: Board): Hex[] {
  return board.hexes
    .filter((h) => ringDepthFromEdge(h, board.hexes) === 0)
    .sort((a, b) => {
      const angA = hexAngle(a);
      const angB = hexAngle(b);
      if (angA !== angB) return angA - angB;
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    });
}

/**
 * The deterministic auto-pick first base for `player`: the ideal evenly-spaced
 * outer-ring index (`floor(player * outerCount / playerCount)`), then a forward
 * (wrapping) scan for the first UNOCCUPIED outer-ring hex. In all-agent setup the
 * ideal indices are distinct, so the ideal hex is always free and this returns it
 * unchanged — all-agent seating is collision-free and deterministic. The skip only
 * triggers in MIXED setup, when a human has taken a hex an agent's ideal would land on.
 */
export function representativeFirstBase(state: GameState, player: PlayerId): Hex {
  const outer = outerRingSorted(state.board);
  const occupied = new Set(state.bases.map((b) => key(b.hex)));
  const ideal = Math.floor((player * outer.length) / state.players.length);
  for (let i = 0; i < outer.length; i++) {
    const h = outer[(ideal + i) % outer.length]!;
    if (!occupied.has(key(h))) return h;
  }
  return outer[ideal]!; // unreachable while outer-ring count >= player count
}

/** The pre-placement setup-phase state: turn 0, id-order placement, no bases yet. */
export function setupPhaseState(rng: RngState, board: Board, nPlayers: number, config: RuleConfig): GameState {
  const players: Player[] = [];
  for (let id = 0; id < nPlayers; id++) {
    players.push({ id, basesInHand: config.baseLimit, alliance: [id], eliminated: false });
  }
  return {
    board, bases: [], factories: [], players,
    phase: { turn: 0, order: players.map((p) => p.id), indexInOrder: 0 },
    factorySupply: config.factorySupply, config, rngState: rng,
  };
}

/** Unoccupied outermost-ring hexes — the legal first-base placements during setup. */
export function legalFirstBaseHexes(state: GameState): Hex[] {
  const occupied = new Set(state.bases.map((b) => key(b.hex)));
  return outerRingSorted(state.board).filter((h) => !occupied.has(key(h)));
}

/**
 * Place `player`'s first base during the setup phase (turn 0). Validates: setup
 * phase active, `player` is the current placer, `hex` is an unoccupied outermost-
 * ring hex. On the LAST placement, draws the turn-1 order and transitions to turn 1.
 * Consumes NO rng for placement; the turn-1 order is drawn by a single
 * shuffle(rng, allIds) at the setup→play transition.
 */
export function placeFirstBase(state: GameState, player: PlayerId, hex: Hex): GameState {
  if (state.phase.turn !== 0) throw new Error("placeFirstBase: not in setup phase");
  const placer = state.phase.order[state.phase.indexInOrder];
  if (placer !== player) throw new Error("placeFirstBase: not this player's setup turn");
  if (!state.board.hexes.some((h) => key(h) === key(hex))) throw new Error("placeFirstBase: hex is not on the board");
  if (ringDepthFromEdge(hex, state.board.hexes) !== 0) throw new Error("placeFirstBase: hex must be an outermost-ring hex");
  if (state.bases.some((b) => key(b.hex) === key(hex))) throw new Error("placeFirstBase: hex is already occupied");

  const bases = [...state.bases, { owner: player, hex, state: "fresh" as const, order: player }];
  const players = state.players.map((p) => (p.id === player ? { ...p, basesInHand: p.basesInHand - 1 } : p));
  const nextIdx = state.phase.indexInOrder + 1;
  if (nextIdx < state.phase.order.length) {
    return { ...state, bases, players, phase: { ...state.phase, indexInOrder: nextIdx } };
  }
  const allIds = players.map((p) => p.id);
  const { result: order, rng } = shuffle(state.rngState, allIds);
  return { ...state, bases, players, rngState: rng, phase: { turn: 1, order, indexInOrder: 0 } };
}

/**
 * Assemble the initial game state for `nPlayers`.
 *
 * Seating: each player's FIRST base is placed on a distinct OUTER-RING hex
 * (ringDepthFromEdge === 0), spaced deterministically around the board by
 * projected angle (tie-broken by canonical key), picking nPlayers evenly-spaced
 * indices. The turn-1 order is drawn UNIFORMLY at random (Fisher–Yates), with
 * the PRNG threaded forward per GEO-3.
 */
export function setupGame(
  rng: RngState,
  board: Board,
  nPlayers: number,
  config: RuleConfig,
): GameState {
  let state = setupPhaseState(rng, board, nPlayers, config);
  for (let i = 0; i < nPlayers; i++) {
    const p = state.phase.order[state.phase.indexInOrder]!;
    state = placeFirstBase(state, p, representativeFirstBase(state, p));
  }
  return state;
}

/** The player whose round it currently is. */
export function currentPlayer(state: GameState): PlayerId {
  return state.phase.order[state.phase.indexInOrder] as PlayerId;
}

/**
 * Draw the order for a NEW turn over the currently NON-ELIMINATED players,
 * given the just-completed turn's order. Threads the rng forward per GEO-3.
 *
 * Rules §Turn Order:
 * - 3+ live players: the players who played LAST and SECOND-TO-LAST in the
 *   just-completed order draw FIRST into the first two slots (bag of two — a
 *   uniform shuffle of those two), then the remaining live players fill the
 *   remaining slots in uniformly-random order. "Last"/"second-to-last" are
 *   identified from the completed order filtered to still-live players, so an
 *   eliminated last/second-to-last falls back to the next-latest live player.
 * - exactly 2 live players: iron-weighted — the first slot is chosen with
 *   probability proportional to each player's controlled-iron count; the other
 *   goes second. If both have zero iron, fall back to uniform.
 * - fewer than 3 live players (i.e. 1): just the single player.
 *
 * INTERPRETATION NOTE: the rules describe "tokens #1 and #2 in the bag" and the
 * last/second-to-last players drawing first. With exactly the two of them in
 * that sub-bag, the faithful reading is: those two occupy slots 0 and 1 in a
 * random order, and everyone else fills the rest randomly. That is what we do.
 */
function drawTurnOrder(
  state: GameState,
  completedOrder: readonly PlayerId[],
): { order: PlayerId[]; rng: RngState } {
  const liveSet = new Set(
    state.players.filter((p) => !p.eliminated).map((p) => p.id),
  );
  const live = [...liveSet];

  // 1 (or 0) live player: nothing to randomize.
  if (live.length <= 1) {
    return { order: live, rng: state.rngState };
  }

  // Exactly 2 live players: iron-weighted first-player draw.
  if (live.length === 2) {
    const [a, b] = live as [PlayerId, PlayerId];
    const wa = control(state, a).iron.length;
    const wb = control(state, b).iron.length;
    const total = wa + wb;
    if (total === 0) {
      // Uniform fallback.
      const sh = shuffle(state.rngState, live);
      return { order: sh.result, rng: sh.rng };
    }
    // Draw r in [0, total); r < wa => `a` first, else `b` first.
    const { value, rng } = nextIntT(state.rngState, total);
    const first = value < wa ? a : b;
    const second = first === a ? b : a;
    return { order: [first, second], rng };
  }

  // 3+ live players: last & second-to-last (among live) go first.
  // Filter the completed order down to still-live players, preserving order.
  const liveInCompleted = completedOrder.filter((id) => liveSet.has(id));
  // The two latest live players in the completed order.
  const last = liveInCompleted[liveInCompleted.length - 1] as PlayerId;
  const secondToLast = liveInCompleted[liveInCompleted.length - 2] as PlayerId;
  const firstTwoIds = [secondToLast, last];

  // Bag of two: uniform shuffle of the first-two players.
  const firstTwoDraw = shuffle(state.rngState, firstTwoIds);
  // Remaining live players (those not in the first two), shuffled uniformly.
  const firstTwoSet = new Set(firstTwoIds);
  const remaining = live.filter((id) => !firstTwoSet.has(id));
  const remainingDraw = shuffle(firstTwoDraw.rng, remaining);

  return {
    order: [...firstTwoDraw.result, ...remainingDraw.result],
    rng: remainingDraw.rng,
  };
}

/**
 * Advance to the next player's round; roll over to a new turn when the current
 * turn's order is exhausted. PURE (returns a new state, threads rng per GEO-3).
 * Requires play to have begun (`phase.turn >= 1`); throws on a setup-phase
 * (turn 0) state, where `placeFirstBase` drives placement instead.
 *
 * - Intra-turn (more players remain this turn): bump indexInOrder; no refresh.
 * - Rollover (turn complete): increment turn, refresh ALL bases to "fresh"
 *   (start-of-turn refresh), draw a fresh turn order over the live players
 *   (per `drawTurnOrder`), and reset indexInOrder to 0.
 */
export function advanceRound(state: GameState): GameState {
  if (state.phase.turn === 0) {
    throw new Error("advanceRound: cannot advance during the setup phase (turn 0); place all first bases first");
  }
  const { order, indexInOrder } = state.phase;

  if (indexInOrder + 1 < order.length) {
    // Same turn, next player. No base refresh, rng untouched.
    return {
      ...state,
      phase: { ...state.phase, indexInOrder: indexInOrder + 1 },
    };
  }

  // Turn complete: begin a new turn.
  const refreshedBases: Base[] = state.bases.map((b) => ({ ...b, state: "fresh" }));
  const { order: newOrder, rng } = drawTurnOrder(state, order);

  return {
    ...state,
    bases: refreshedBases,
    rngState: rng,
    phase: { turn: state.phase.turn + 1, order: newOrder, indexInOrder: 0 },
  };
}
