// ABOUTME: legalActions — enumerates the concrete legal actions for the current player (spec §9).
// ABOUTME: Pure, no Math.random; attacks emit one deterministic representative per (target, commitment level).

import { distance, key } from "../geometry/cube";
import { convexHull, hullArea } from "../geometry/hull";
import { buildBudget, isLegalBasePlacement, isLegalFactoryPlacement } from "./build";
import type { Action, Base, GameState, Hex, PlayerId } from "./types";

const MIN_ATTACKERS = 3;
const MAX_ATTACKERS = 6;
const PERIMETER_BASE_COUNT = 4;

/** The acting player is whoever's round it is. */
function currentPlayer(state: GameState): PlayerId {
  return state.phase.order[state.phase.indexInOrder]!;
}

/**
 * Is opponent base `t` a valid OUTER-perimeter target for an attack?
 *
 * A radiating opponent (<4 bases, or a degenerate/colinear hull) exposes every
 * base. A perimetered opponent (4+ non-degenerate hull) exposes only its hull
 * VERTICES. Mirrors applyOneAttack's target validation so every emitted attack
 * is accepted.
 */
function isOuterTarget(oppBases: Base[], t: Hex): boolean {
  if (oppBases.length < PERIMETER_BASE_COUNT) return true;
  const hull = convexHull(oppBases.map((b) => b.hex));
  if (hullArea(hull) <= 0) return true; // degenerate/colinear => radiating
  return hull.some((h) => key(h) === key(t));
}

/**
 * Enumerate the legal actions for the CURRENT player. Pure: derives everything
 * from `state`, never mutates it, and uses no randomness. Each emitted action is
 * constructed to satisfy applyAction's validation (so it never throws).
 *
 * 1. BUILD — single-piece building blocks. With budget >= 1, for every board hex
 *    emit a single-piece factory build and/or base build wherever the legality
 *    predicate holds. The agent composes multi-piece builds by greedy sequencing
 *    (spec §11); move-gen never enumerates combinations.
 * 2. ATTACK — deterministic representatives. For each valid outer target and each
 *    commitment level c in 3..min(6, eligibleAttackers), emit ONE action: the c
 *    eligible attacker bases NEAREST the target (distance asc, tie by ascending
 *    key). This bounds the action space to one representative per (target, level)
 *    rather than every attacker subset. Single-AttackDecl actions only; the agent
 *    may chain multi-attacks.
 * 3. PASS — included if config.allowPass is true, OR if no build/attack action was
 *    generated (a stuck player always has at least `pass` so the game progresses).
 */
export function legalActions(state: GameState): Action[] {
  const player = currentPlayer(state);
  const alliance = state.players[player]!.alliance;
  const isAlly = (id: PlayerId): boolean => alliance.includes(id);
  const range = state.config.attackRange;
  const actions: Action[] = [];

  // 1. BUILD — one single-piece action per legal placement.
  if (buildBudget(state, player) >= 1) {
    for (const h of state.board.hexes) {
      if (isLegalFactoryPlacement(state, player, h)) {
        actions.push({ kind: "build", pieces: [{ type: "factory", hex: h }] });
      }
      if (isLegalBasePlacement(state, player, h)) {
        actions.push({ kind: "build", pieces: [{ type: "base", hex: h }] });
      }
    }
  }

  // 2. ATTACK — one representative per (valid outer target, commitment level).
  const myFresh = state.bases.filter((b) => isAlly(b.owner) && b.state === "fresh");
  // Candidate targets: every opponent (non-ally) base.
  for (const targetBase of state.bases) {
    if (isAlly(targetBase.owner)) continue;
    const opponent = targetBase.owner;
    const oppBases = state.bases.filter((b) => b.owner === opponent);
    const t = targetBase.hex;

    if (!isOuterTarget(oppBases, t)) continue;

    // Eligible attackers: my fresh bases within attackRange of t, sorted nearest
    // first (distance asc, tie by ascending key) so the level-c subset is the
    // first c — a deterministic representative, NOT every subset.
    const eligibleAttackers = myFresh
      .filter((b) => distance(b.hex, t) <= range)
      .slice()
      .sort((a, b) => {
        const da = distance(a.hex, t);
        const db = distance(b.hex, t);
        if (da !== db) return da - db;
        return key(a.hex) < key(b.hex) ? -1 : key(a.hex) > key(b.hex) ? 1 : 0;
      });
    if (eligibleAttackers.length < MIN_ATTACKERS) continue;

    // Eligible defenders: opponent fresh bases within range of t, EXCLUDING t
    // itself (the target cannot also defend itself — that would be no defending
    // base). Chosen defender = nearest t, tie by smallest key.
    const eligibleDefenders = oppBases
      .filter((b) => b.state === "fresh" && key(b.hex) !== key(t) && distance(b.hex, t) <= range)
      .slice()
      .sort((a, b) => {
        const da = distance(a.hex, t);
        const db = distance(b.hex, t);
        if (da !== db) return da - db;
        return key(a.hex) < key(b.hex) ? -1 : key(a.hex) > key(b.hex) ? 1 : 0;
      });
    if (eligibleDefenders.length === 0) continue;
    const defender = eligibleDefenders[0]!.hex;

    const maxCommit = Math.min(MAX_ATTACKERS, eligibleAttackers.length);
    for (let c = MIN_ATTACKERS; c <= maxCommit; c++) {
      const attackers = eligibleAttackers.slice(0, c).map((b) => b.hex);
      actions.push({ kind: "attack", attacks: [{ target: t, attackers, defender }] });
    }
  }

  // 2b. ALLY + BREAK-ALLIANCE — alliance layer (default off via alliancesEnabled).
  if (state.config.alliancesEnabled) {
    const actor = state.players[player]!;
    if (actor.allianceCooldownTurns === 0) {
      // ally — basesInHand >= 1 (commit cost); target is a different LIVE non-allied player.
      if (actor.basesInHand >= 1) {
        const alreadyAllied = new Set(actor.alliance);
        for (const other of state.players) {
          if (other.id === player) continue;
          if (other.eliminated) continue;
          if (alreadyAllied.has(other.id)) continue;
          actions.push({ kind: "ally", target: other.id });
        }
      }
      // break-alliance — for each ALLY (other than self) that is still live.
      for (const allyId of actor.alliance) {
        if (allyId === player) continue;
        const allyPlayer = state.players[allyId];
        if (allyPlayer === undefined || allyPlayer.eliminated) continue;
        actions.push({ kind: "break-alliance", target: allyId });
      }
    }
  }

  // 3. PASS — when allowed, or when otherwise stuck (so the game always progresses).
  if (state.config.allowPass || actions.length === 0) {
    actions.push({ kind: "pass" });
  }

  return actions;
}
