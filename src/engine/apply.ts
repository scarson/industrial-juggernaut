// ABOUTME: applyAction — the engine's pure state-transition function (spec §4/§8).
// ABOUTME: Task 5.3 implements the build branch; attack lands in Task 5.4. Returns a NEW state, never mutates input.

import { buildBudget, isLegalBasePlacement, isLegalFactoryPlacement } from "./build";
import { resolveCombat } from "./combat";
import { distance, key } from "../geometry/cube";
import { convexHull, hullArea } from "../geometry/hull";
import { nextFloat } from "../rng/pcg";
import type { Action, AttackDecl, Base, Factory, GameEvent, GameState, PlayerId } from "./types";

/** The acting player is whoever's round it is. */
function currentPlayer(state: GameState): PlayerId {
  return state.phase.order[state.phase.indexInOrder]!;
}

/** Max `order` over every base on the board, or -1 when there are none. */
function maxOrder(bases: Base[]): number {
  let max = -1;
  for (const b of bases) {
    if (b.order > max) max = b.order;
  }
  return max;
}

/**
 * Apply a build action. Pieces are validated against the state AS MUTATED SO FAR
 * (progressive validation, GEO-5: legality recomputed per piece): an earlier
 * piece occupies its hex and reshapes the perimeter for later pieces, and the
 * factory supply / bases-in-hand deplete as we go. We mutate cloned working
 * copies only — the input `state` is never touched.
 */
function applyBuild(
  state: GameState,
  player: PlayerId,
  pieces: { type: "factory" | "base"; hex: GameState["board"]["hexes"][number] }[],
): { state: GameState; events: GameEvent[] } {
  if (pieces.length === 0) {
    throw new Error("applyAction(build): pieces must be non-empty");
  }
  const type = pieces[0]!.type;
  if (pieces.some((p) => p.type !== type)) {
    throw new Error("applyAction(build): all pieces must be the same type (one type per round)");
  }

  const budget = buildBudget(state, player);
  if (pieces.length > budget) {
    throw new Error(
      `applyAction(build): ${pieces.length} pieces exceeds build budget ${budget}`,
    );
  }

  // Clone the arrays/objects we will change; everything else is shared (pure).
  let working: GameState = {
    ...state,
    bases: state.bases.slice(),
    factories: state.factories.slice(),
    players: state.players.map((p) => ({ ...p })),
  };
  const events: GameEvent[] = [];

  for (const piece of pieces) {
    if (piece.type === "factory") {
      if (!isLegalFactoryPlacement(working, player, piece.hex)) {
        throw new Error(
          `applyAction(build): illegal factory placement at ${piece.hex.x},${piece.hex.y},${piece.hex.z}`,
        );
      }
      const factory: Factory = { hex: piece.hex };
      working = {
        ...working,
        factories: [...working.factories, factory],
        factorySupply: working.factorySupply - 1,
      };
      events.push({ kind: "placed", piece: "factory", hex: piece.hex, owner: player });
    } else {
      if (working.players[player]!.basesInHand <= 0) {
        throw new Error("applyAction(build): no bases in hand to place");
      }
      if (!isLegalBasePlacement(working, player, piece.hex)) {
        throw new Error(
          `applyAction(build): illegal base placement at ${piece.hex.x},${piece.hex.y},${piece.hex.z}`,
        );
      }
      const nextOrder = maxOrder(working.bases) + 1;
      const base: Base = { owner: player, hex: piece.hex, state: "fresh", order: nextOrder };
      const players = working.players.map((p) =>
        p.id === player ? { ...p, basesInHand: p.basesInHand - 1 } : p,
      );
      working = {
        ...working,
        bases: [...working.bases, base],
        players,
      };
      events.push({ kind: "placed", piece: "base", hex: piece.hex, owner: player });
    }
  }

  return { state: working, events };
}

const MIN_ATTACKERS = 3;
const MAX_ATTACKERS = 6;
const PERIMETER_BASE_COUNT = 4;

/**
 * Apply a single AttackDecl against the given state (spec §8 "Attack"). Returns a
 * NEW state (the input is never mutated) and the events the attack produced.
 *
 * Validation throws on any rule violation — callers (legalActions / agents)
 * pre-check, so a throw here is a programming error, not a normal control path.
 * Multi-attack folds over this helper, threading the evolving state (including
 * accumulated fatigue and the advanced PRNG) into the next declaration.
 */
function applyOneAttack(
  state: GameState,
  player: PlayerId,
  decl: AttackDecl,
): { state: GameState; events: GameEvent[] } {
  const { target, attackers, defender } = decl;
  const alliance = state.players[player]!.alliance;
  const isAlly = (id: PlayerId): boolean => alliance.includes(id);
  const range = state.config.attackRange;

  // 1. Target validity: an opponent base sits at `target` and (if that opponent
  //    is perimetered) `target` is on their OUTER hull.
  const targetBase = state.bases.find((b) => key(b.hex) === key(target) && !isAlly(b.owner));
  if (!targetBase) {
    throw new Error(
      `applyAction(attack): no opponent base at target ${target.x},${target.y},${target.z}`,
    );
  }
  const opponent = targetBase.owner;
  const oppBases = state.bases.filter((b) => b.owner === opponent);
  if (oppBases.length >= PERIMETER_BASE_COUNT) {
    const hull = convexHull(oppBases.map((b) => b.hex));
    // A non-degenerate hull (enclosed interior) means only its VERTICES are on
    // the outer perimeter. A degenerate/colinear hull (area 0) is still radiating
    // (every base attackable) per control()'s R3 fallback.
    if (hullArea(hull) > 0) {
      const isVertex = hull.some((h) => key(h) === key(target));
      if (!isVertex) {
        throw new Error(
          `applyAction(attack): target ${target.x},${target.y},${target.z} is interior to opponent ${opponent}'s perimeter, not a hull vertex`,
        );
      }
    }
  }

  // 2. Attackers: 3..6 friendly/allied FRESH bases within attackRange of target.
  if (attackers.length < MIN_ATTACKERS || attackers.length > MAX_ATTACKERS) {
    throw new Error(
      `applyAction(attack): ${attackers.length} attackers; must be ${MIN_ATTACKERS}..${MAX_ATTACKERS}`,
    );
  }
  const attackerBases: Base[] = attackers.map((h) => {
    const base = state.bases.find((b) => key(b.hex) === key(h) && isAlly(b.owner));
    if (!base) {
      throw new Error(`applyAction(attack): no friendly base at attacker ${h.x},${h.y},${h.z}`);
    }
    if (base.state !== "fresh") {
      throw new Error(`applyAction(attack): attacker ${h.x},${h.y},${h.z} is fatigued`);
    }
    if (distance(base.hex, target) > range) {
      throw new Error(`applyAction(attack): attacker ${h.x},${h.y},${h.z} out of attackRange ${range}`);
    }
    return base;
  });
  const commit = attackers.length as 3 | 4 | 5 | 6;

  // 3. Defender: exactly one base at `defender`, owned by the SAME opponent as
  //    the target base, fresh, within attackRange of target.
  const defenderBase = state.bases.find((b) => key(b.hex) === key(defender));
  if (!defenderBase) {
    throw new Error(`applyAction(attack): no base at defender ${defender.x},${defender.y},${defender.z}`);
  }
  if (defenderBase.owner !== opponent) {
    throw new Error(
      `applyAction(attack): defender ${defender.x},${defender.y},${defender.z} not owned by target's owner ${opponent}`,
    );
  }
  if (defenderBase.state !== "fresh") {
    throw new Error(`applyAction(attack): defender ${defender.x},${defender.y},${defender.z} is fatigued`);
  }
  if (distance(defenderBase.hex, target) > range) {
    throw new Error(`applyAction(attack): defender ${defender.x},${defender.y},${defender.z} out of attackRange ${range}`);
  }

  // 4. Resolve combat — single Bernoulli draw threaded through the PRNG (GEO-3).
  const { attackerWon, state: rng2 } = resolveCombat(state.rngState, commit, state.config);

  // Identity set of committed bases (attackers + defender) for fatigue. Keyed by
  // canonical hex string + owner so we never confuse two players sharing geometry.
  const committedKeys = new Set<string>([
    ...attackerBases.map((b) => `${b.owner}@${key(b.hex)}`),
    `${defenderBase.owner}@${key(defenderBase.hex)}`,
  ]);

  const events: GameEvent[] = [];
  events.push({ kind: "combat", target, committed: commit, attackerWon });

  // 5. Fatigue all committed bases (regardless of outcome). Remove the captured
  //    target base on a win; we rebuild `bases` once below.
  let bases: Base[] = state.bases.map((b) => {
    if (committedKeys.has(`${b.owner}@${key(b.hex)}`)) {
      return { ...b, state: "fatigued" };
    }
    return b;
  });

  const players = state.players.map((p) => ({ ...p }));

  // 6. Outcome.
  if (attackerWon) {
    // Remove the opponent's captured target base.
    bases = bases.filter((b) => !(b.owner === opponent && key(b.hex) === key(target)));

    if (players[player]!.basesInHand > 0) {
      // Place a fresh replacement base for the acting player on the captured hex.
      const nextOrder = maxOrder(bases) + 1;
      bases.push({ owner: player, hex: target, state: "fresh", order: nextOrder });
      players[player]!.basesInHand -= 1;
      events.push({ kind: "baseReplaced", hex: target, from: opponent, to: player });
    } else {
      // MAXED OUT (12 bases on board, basesInHand === 0). Spec §8 allows EITHER
      // relocating an existing base to the captured hex OR destroying the base
      // with no replacement. For M1 we take the simpler spec-legal option:
      // DESTROY with no replacement. Optional relocation is deferred to a later
      // refinement (it carries the extra "resulting perimeter still meets an
      // opponent perimeter" precondition the spec attaches to relocation).
      events.push({ kind: "baseDestroyed", hex: target, owner: opponent });
    }
  }
  // Defender wins (!attackerWon): only fatigue changed; no base swap (spec §8 "Loss").

  // Perimeters are DERIVED (control()/hull recompute on demand, GEO-5): swapping
  // the base is sufficient — we never mutate a stored perimeter here. Stranded
  // bases (5.5), elimination (5.6), and turn/fatigue-reset (5.8) are out of scope.
  const next: GameState = { ...state, bases, players, rngState: rng2 };
  return { state: next, events };
}

/**
 * Apply an attack action: process each AttackDecl IN SEQUENCE, threading the
 * evolving state (accumulated fatigue + advanced PRNG) into the next. Each decl
 * validates against the state left by the previous one — so an attacker fatigued
 * by an earlier decl can no longer be reused.
 */
function applyAttack(
  state: GameState,
  player: PlayerId,
  attacks: AttackDecl[],
): { state: GameState; events: GameEvent[] } {
  let working = state;
  const events: GameEvent[] = [];
  for (const decl of attacks) {
    const result = applyOneAttack(working, player, decl);
    working = result.state;
    events.push(...result.events);
  }
  return { state: working, events };
}

/**
 * Pure state-transition: returns a NEW state and the events it produced. The
 * acting player is the current player (`phase.order[phase.indexInOrder]`). Phase
 * advancement (turn/round/fatigue) is NOT done here — that is Task 5.8.
 */
export function applyAction(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  switch (action.kind) {
    case "build":
      return applyBuild(state, currentPlayer(state), action.pieces);
    case "pass":
      return { state, events: [] };
    case "attack":
      return applyAttack(state, currentPlayer(state), action.attacks);
    case "ally":
      return applyAlly(state, currentPlayer(state), action.target);
    case "break-alliance":
      return applyBreakAlliance(state, currentPlayer(state), action.target);
  }
}

/**
 * Apply a `break-alliance` action: a weighted coin flip — 2/3 success, 1/3 failure. On SUCCESS,
 * mutually remove the alliance refs. On FAILURE, the alliance arrays are unchanged. EITHER WAY,
 * the actor's `allianceCooldownTurns` is set to 1 (the betrayer pays for the attempt regardless
 * of outcome). Draws ONE float from state.rngState (GEO-3); the advanced rng is threaded into the
 * returned state. The probability threshold (2/3) is fixed per the alliance design spec.
 */
const BREAK_ALLIANCE_SUCCESS_THRESHOLD = 2 / 3;
function applyBreakAlliance(state: GameState, actor: PlayerId, target: PlayerId): { state: GameState; events: GameEvent[] } {
  if (!state.config.alliancesEnabled) {
    throw new Error(`applyBreakAlliance: alliancesEnabled is false; break-alliance action is not allowed`);
  }
  const { value: roll, state: rngNext } = nextFloat(state.rngState);
  const success = roll < BREAK_ALLIANCE_SUCCESS_THRESHOLD;
  const players = state.players.map((p) => {
    if (p.id === actor) {
      const next = success ? p.alliance.filter((id) => id !== target) : p.alliance;
      return { ...p, alliance: next, allianceCooldownTurns: 1 };
    }
    if (p.id === target && success) {
      return { ...p, alliance: p.alliance.filter((id) => id !== actor) };
    }
    return p;
  });
  return { state: { ...state, players, rngState: rngNext }, events: [] };
}

/**
 * Apply an `ally` action: mutually add each player to the other's alliance array, and decrement
 * the actor's basesInHand by 1 as the commit cost. Idempotent — if the players are already
 * mutually allied, the alliance arrays are unchanged (no duplicate ids). Throws when alliances
 * are not enabled by config — that is a defense-in-depth check; legalActions already enforces
 * the gate.
 */
function applyAlly(state: GameState, actor: PlayerId, target: PlayerId): { state: GameState; events: GameEvent[] } {
  if (!state.config.alliancesEnabled) {
    throw new Error(`applyAlly: alliancesEnabled is false; ally action is not allowed`);
  }
  if (actor === target) {
    throw new Error(`applyAlly: actor and target must differ (got ${actor})`);
  }
  const players = state.players.map((p) => {
    if (p.id === actor) {
      const next = p.alliance.includes(target) ? p.alliance : [...p.alliance, target];
      return { ...p, alliance: next, basesInHand: p.basesInHand - 1 };
    }
    if (p.id === target) {
      const next = p.alliance.includes(actor) ? p.alliance : [...p.alliance, actor];
      return { ...p, alliance: next };
    }
    return p;
  });
  return { state: { ...state, players }, events: [] };
}
