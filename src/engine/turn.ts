// ABOUTME: Turn/round orchestration — game setup, current-player lookup, and round/turn advancement.
// ABOUTME: All functions are PURE: they return new state and thread `rngState` forward per GEO-3 (no Math.random).

import { key } from "../geometry/cube";
import { ringDepthFromEdge } from "../board/shape";
import { control } from "./control";
import { coalitions, coalitionVictoryIron } from "./status";
import { nextInt } from "../rng/pcg";
import type { RuleConfig } from "./config";
import type {
  Base,
  Board,
  GameState,
  Phase,
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
  // Players: ids 0..nPlayers-1, one base placed below so basesInHand = baseLimit-1.
  const players: Player[] = [];
  for (let id = 0; id < nPlayers; id++) {
    players.push({
      id,
      basesInHand: config.baseLimit - 1,
      alliance: [id],
      eliminated: false,
      victoryStreak: 0,
      allianceCooldownTurns: 0,
    });
  }

  // Outer-ring hexes, deterministically sorted by projected angle then key.
  const outer = board.hexes
    .filter((h) => ringDepthFromEdge(h, board.hexes) === 0)
    .sort((a, b) => {
      const angA = hexAngle(a);
      const angB = hexAngle(b);
      if (angA !== angB) return angA - angB;
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    });

  const bases: Base[] = [];
  for (let id = 0; id < nPlayers; id++) {
    const idx = Math.floor((id * outer.length) / nPlayers);
    const hexAt = outer[idx] as Board["hexes"][number];
    bases.push({ owner: id, hex: hexAt, state: "fresh", order: id, type: "forge" });
  }

  // Turn 1 order: uniform over all player ids.
  const allIds = players.map((p) => p.id);
  const { result: order, rng: rngState } = shuffle(rng, allIds);

  const phase: Phase = { turn: 1, order, indexInOrder: 0 };

  return {
    board,
    bases,
    factories: [],
    players,
    phase,
    factorySupply: config.factorySupply,
    config,
    rngState,
  };
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
 *
 * - Intra-turn (more players remain this turn): bump indexInOrder; no refresh.
 * - Rollover (turn complete): increment turn, refresh ALL bases to "fresh"
 *   (start-of-turn refresh), draw a fresh turn order over the live players
 *   (per `drawTurnOrder`), and reset indexInOrder to 0.
 */
export function advanceRound(state: GameState): GameState {
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

  // Variant (b)/P2 hold-iron-for-N-rounds: at end-of-turn, advance each player's
  // victoryStreak based on whether their coalition meets the (alliance-scaled)
  // `victoryThreshold` iron RIGHT NOW. Players whose coalition meets the scaled
  // threshold get streak++; others reset to 0. Unconditional bookkeeping — when
  // `victoryIronHoldRounds === 1` (default) the streak doesn't affect `status()`.
  // The threshold here mirrors `status()`'s scaling: under alliances enabled, a
  // coalition of size N requires `threshold + (N - 1) * allianceVictoryDelta` so
  // the streak only counts "would-be-winning" rounds — not "would-meet-singleton-threshold-but-no-victory" rounds.
  const threshold = state.config.victoryThreshold;
  const allianceDelta = state.config.alliancesEnabled ? state.config.allianceVictoryDelta : 0;
  const comps = coalitions(state);
  const meetingThreshold = new Set<PlayerId>();
  for (const comp of comps) {
    const scaledThreshold = threshold + Math.max(0, comp.length - 1) * allianceDelta;
    if (coalitionVictoryIron(state, comp) >= scaledThreshold) {
      for (const id of comp) meetingThreshold.add(id);
    }
  }
  const players: Player[] = state.players.map((p) =>
    p.eliminated
      ? p
      : {
          ...p,
          victoryStreak: meetingThreshold.has(p.id) ? p.victoryStreak + 1 : 0,
          // Alliance Phase 5: decrement cooldown by 1, floored at 0.
          allianceCooldownTurns: Math.max(0, p.allianceCooldownTurns - 1),
        },
  );

  return {
    ...state,
    bases: refreshedBases,
    players,
    rngState: rng,
    phase: { turn: state.phase.turn + 1, order: newOrder, indexInOrder: 0 },
  };
}
