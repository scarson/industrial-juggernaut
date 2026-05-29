// ABOUTME: legalActions — enumerates the concrete legal actions for the current player (spec §9).
// ABOUTME: Pure, no Math.random; attacks emit one deterministic representative per (target, commitment level).

import { distance, key } from "../geometry/cube";
import { convexHull, hullArea } from "../geometry/hull";
import { buildBudget, buildBudgetForType, isLegalBasePlacement, isLegalFactoryPlacement } from "./build";
import type { Action, Base, BaseType, GameState, Hex, PlayerId } from "./types";

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
  // Tactical Depth Phase 5: when `baseTypesEnabled`, each legal base-placement hex
  // emits THREE actions (one per subtype forge/watchtower/outpost) whose individual
  // single-piece budgets satisfy `buildBudgetForType(state, player, T) >= 1`. Hexes
  // with no subtype affordable are skipped. When the flag is off, the legacy single
  // base action is emitted (no `baseType` field — defaults to forge), bit-for-bit
  // identical to pre-Phase-5 behavior.
  if (buildBudget(state, player) >= 1 || state.config.baseTypesEnabled) {
    const baseSubtypes: BaseType[] = state.config.baseTypesEnabled
      ? ["forge", "watchtower", "outpost"]
      : ["forge"];
    const affordableSubtypes = baseSubtypes.filter(
      (t) => buildBudgetForType(state, player, t) >= 1,
    );
    for (const h of state.board.hexes) {
      if (isLegalFactoryPlacement(state, player, h) && buildBudget(state, player) >= 1) {
        actions.push({ kind: "build", pieces: [{ type: "factory", hex: h }] });
      }
      if (isLegalBasePlacement(state, player, h)) {
        if (state.config.baseTypesEnabled) {
          for (const subtype of affordableSubtypes) {
            actions.push({ kind: "build", pieces: [{ type: "base", hex: h, baseType: subtype }] });
          }
        } else if (buildBudget(state, player) >= 1) {
          actions.push({ kind: "build", pieces: [{ type: "base", hex: h }] });
        }
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
      // BANNED: an ally action that would merge all currently-alive players into a single
      // coalition. Such a state is functionally indistinguishable from unanimous concession
      // (everyone "wins together") and previously slipped through `status()`'s
      // "exactly one non-eliminated coalition remaining → last-standing" rule on turn 1
      // under high alliance-weight play. Rejecting here keeps the rule semantics clean: the
      // "exactly one coalition remaining" path is reachable only via elimination.
      if (actor.basesInHand >= 1) {
        const alreadyAllied = new Set(actor.alliance);
        const aliveCount = state.players.filter((p) => !p.eliminated).length;
        // Precompute the size of each player's current coalition (via the undirected
        // alliance relation among alive players). Doing this once rather than per-target
        // keeps the cost O(N²) over players, not O(N³).
        const coalitionSizeOf = new Map<PlayerId, number>();
        for (const p of state.players) {
          if (p.eliminated) continue;
          // BFS over the alliance graph starting at p, counting alive members reachable.
          const visited = new Set<PlayerId>([p.id]);
          const stack = [p.id];
          while (stack.length > 0) {
            const cur = stack.pop()!;
            const curPlayer = state.players[cur]!;
            for (const allyId of curPlayer.alliance) {
              if (allyId === cur) continue;
              if (visited.has(allyId)) continue;
              const allyPlayer = state.players[allyId];
              if (allyPlayer === undefined || allyPlayer.eliminated) continue;
              visited.add(allyId);
              stack.push(allyId);
            }
            // Also include any alive player who has `cur` in their alliance (symmetric closure).
            for (const q of state.players) {
              if (q.eliminated) continue;
              if (visited.has(q.id)) continue;
              if (q.alliance.includes(cur)) {
                visited.add(q.id);
                stack.push(q.id);
              }
            }
          }
          coalitionSizeOf.set(p.id, visited.size);
        }
        const actorCoalSize = coalitionSizeOf.get(player) ?? 1;
        for (const other of state.players) {
          if (other.id === player) continue;
          if (other.eliminated) continue;
          if (alreadyAllied.has(other.id)) continue;
          const otherCoalSize = coalitionSizeOf.get(other.id) ?? 1;
          // Reject when the prospective merged coalition would equal all alive players.
          if (actorCoalSize + otherCoalSize === aliveCount) continue;
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
