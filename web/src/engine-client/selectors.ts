// ABOUTME: Memoized read accessors over engine functions, keyed on GameState identity — spares
// ABOUTME: the client from recomputing control()/strandedBases() unions on every render pass.
import {
  control,
  currentPlayer,
  buildBudget,
  strandedBases,
} from "./barrel";
import { hexKey } from "../board/projection";
import type { Control, GameState, PlayerId } from "./barrel";

// Each cache is a WeakMap keyed on the immutable GameState reference — a pure-function
// cache keyed by immutable input, NOT derived state stored on the model; the engine
// never sees this cache (GEO-5). A new GameState (the engine never mutates in place)
// naturally misses every cache, so staleness is impossible by construction.
const controlCache = new WeakMap<GameState, Map<PlayerId, Control>>();
const strandedCache = new WeakMap<GameState, Set<string>>();

/** Memoized `control(state, player)` — identity-equal result for a repeat call on the same state. */
export function controlOf(state: GameState, player: PlayerId): Control {
  let perPlayer = controlCache.get(state);
  if (perPlayer === undefined) {
    perPlayer = new Map();
    controlCache.set(state, perPlayer);
  }
  let result = perPlayer.get(player);
  if (result === undefined) {
    result = control(state, player);
    perPlayer.set(player, result);
  }
  return result;
}

/** Alias for `currentPlayer(state)` — the seat whose turn it is. */
export function currentSeat(state: GameState): PlayerId {
  return currentPlayer(state);
}

/**
 * Count of factories placed on the board so far. `factorySupply` counts DOWN from
 * `config.factorySupply` (a tunable knob, default 36 — see RuleConfig), so the
 * rule-agnostic count is the config's starting supply minus what remains.
 */
export function factoriesPlaced(state: GameState): number {
  return state.config.factorySupply - state.factorySupply;
}

/** Alias for `buildBudget(state, player)` — the player's spendable build budget this round. */
export function budgetOf(state: GameState, player: PlayerId): number {
  return buildBudget(state, player);
}

/**
 * Memoized union of `strandedBases(state, p).hex` (as canonical `hexKey`s) over every
 * non-eliminated player — the hexes the board renderer should flag as stranded.
 */
export function strandedHexKeys(state: GameState): Set<string> {
  const cached = strandedCache.get(state);
  if (cached !== undefined) return cached;

  const keys = new Set<string>();
  for (const p of state.players) {
    if (p.eliminated) continue;
    for (const base of strandedBases(state, p.id)) keys.add(hexKey(base.hex));
  }

  strandedCache.set(state, keys);
  return keys;
}
