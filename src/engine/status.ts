// ABOUTME: Terminal-state machinery (spec §8) — coalitions, coalition iron (union dedup), victory check, elimination causes & bounty.
// ABOUTME: All pure; status() is the end-of-round game-over check, applyEliminations() runs after actions with the acting player as byPlayer.

import { key } from "../geometry/cube";
import { control } from "./control";
import type { EliminationCause, GameEvent, GameState, Player, PlayerId } from "./types";

/**
 * Connected components of NON-eliminated players under the (undirected) alliance
 * relation: p and q are in the same coalition if q ∈ p.alliance or p ∈ q.alliance.
 * `alliance` includes self by convention, so a solo player is a singleton.
 *
 * For M1 the agent forms no alliances, so each non-eliminated player is its own
 * singleton — but the union-find here makes coalition victory work in general.
 * Components are returned in ascending order of their lowest member id; members
 * within a component are sorted ascending for determinism.
 */
export function coalitions(state: GameState): PlayerId[][] {
  const live = state.players.filter((p) => !p.eliminated);
  const ids = new Set<PlayerId>(live.map((p) => p.id));

  // Undirected adjacency: edge p—q if either lists the other (and both are live).
  const adj = new Map<PlayerId, Set<PlayerId>>();
  for (const p of live) adj.set(p.id, new Set<PlayerId>());
  const link = (a: PlayerId, b: PlayerId): void => {
    if (a === b) return;
    if (!ids.has(a) || !ids.has(b)) return;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const p of live) {
    for (const other of p.alliance) link(p.id, other);
  }
  // Also honour the reverse direction (q lists p) — link() is symmetric so the
  // loop above already covers it when we visit q, but guard for one-sided lists.
  for (const p of live) {
    for (const q of live) {
      if (q.alliance.includes(p.id)) link(p.id, q.id);
    }
  }

  const seen = new Set<PlayerId>();
  const components: PlayerId[][] = [];
  // Visit ids in ascending order so component order is deterministic.
  const sortedIds = [...ids].sort((a, b) => a - b);
  for (const start of sortedIds) {
    if (seen.has(start)) continue;
    const comp: PlayerId[] = [];
    const stack: PlayerId[] = [start];
    seen.add(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of adj.get(cur)!) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    comp.sort((a, b) => a - b);
    components.push(comp);
  }
  return components;
}

/**
 * Number of DISTINCT iron hexes controlled by ANY member of `members`: the union
 * (deduplicated by canonical key, GEO-4) of each member's controlled iron. Union,
 * not sum — two radiating allies that both control the same iron hex count it once.
 */
export function coalitionIron(state: GameState, members: PlayerId[]): number {
  const keys = new Set<string>();
  for (const m of members) {
    for (const h of control(state, m).iron) keys.add(key(h));
  }
  return keys.size;
}

/**
 * Iron count that COUNTS TOWARD VICTORY for `members`. Under the default
 * `victoryIronRequiresPerimeter: false`, identical to {@link coalitionIron} — every
 * controlled iron hex counts. Under variant (a)/P3 (`true`), only iron held by a
 * member who is in the PERIMETER regime counts (radiating-only members contribute
 * NOTHING to victory iron, though their iron still counts for `resourceCount`).
 */
export function coalitionVictoryIron(state: GameState, members: PlayerId[]): number {
  if (!state.config.victoryIronRequiresPerimeter) return coalitionIron(state, members);
  const keys = new Set<string>();
  for (const m of members) {
    const ctl = control(state, m);
    if (!ctl.perimeter) continue;
    for (const h of ctl.iron) keys.add(key(h));
  }
  return keys.size;
}

export type Status =
  | { kind: "ongoing" }
  | { kind: "victory"; players: PlayerId[]; reason: "iron" | "last-standing" };

/**
 * End-of-round game-over check (spec §8). Pure.
 *
 * (a) Iron victory FIRST: if any coalition controls ≥ victoryThreshold distinct
 *     iron, that coalition wins (reason "iron"). Multiple → most iron; ties → the
 *     coalition containing the lowest player id (deterministic).
 * (b) Else last-standing: exactly ONE non-eliminated coalition remaining → it wins
 *     (reason "last-standing"). ZERO coalitions (everyone eliminated, degenerate) →
 *     victory with empty players, reason "last-standing", so the driver always
 *     terminates (documented edge case).
 * (c) Else ongoing.
 */
export function status(state: GameState): Status {
  const comps = coalitions(state);
  const threshold = state.config.victoryThreshold;

  // (a) Iron victory — checked BEFORE last-standing (Round-4 refinement).
  // Under variant (a)/P3 (`victoryIronRequiresPerimeter`), only perimeter-held iron counts here.
  // Under variant (b)/P2 (`victoryIronHoldRounds` > 1), the coalition must additionally have
  // held the threshold across at least (holdRounds - 1) prior end-of-turn checks — i.e. some
  // member's `victoryStreak >= holdRounds - 1`. Default holdRounds=1 short-circuits the gate
  // (instant victory the moment the threshold is met), preserving current behavior.
  const holdRounds = state.config.victoryIronHoldRounds;
  let best: { players: PlayerId[]; iron: number } | null = null;
  for (const comp of comps) {
    const iron = coalitionVictoryIron(state, comp);
    if (iron < threshold) continue;
    if (holdRounds > 1) {
      const coalitionStreak = Math.max(
        ...comp.map((id) => state.players.find((p) => p.id === id)!.victoryStreak),
      );
      if (coalitionStreak < holdRounds - 1) continue;
    }
    if (
      best === null ||
      iron > best.iron ||
      (iron === best.iron && comp[0]! < best.players[0]!)
    ) {
      best = { players: comp, iron };
    }
  }
  if (best !== null) return { kind: "victory", players: best.players, reason: "iron" };

  // (b) Last-standing: zero or one coalition left.
  if (comps.length === 0) return { kind: "victory", players: [], reason: "last-standing" };
  if (comps.length === 1) return { kind: "victory", players: comps[0]!, reason: "last-standing" };

  // (c)
  return { kind: "ongoing" };
}

function bountyCount(killBounty: GameState["config"]["killBounty"]): number {
  switch (killBounty) {
    case "full":
      return 12;
    case "half":
      return 6;
    case "none":
      return 0;
  }
}

/**
 * Apply eliminations in a single pass (no cascade — the driver re-invokes). Pure:
 * returns a NEW state plus one event per elimination.
 *
 * For each currently NON-eliminated player P the FIRST matching cause is assigned:
 *  1. noBases — P has 0 bases on the board.
 *  2. brokenPerimeterAt18Factories — P CONTROLS ≥ brokenPerimeterDeathAtFactories
 *     factories AND P has < 4 bases (industry-without-territory in the late game).
 *     This is a PER-PLAYER clock keyed on P's own controlled factories — a player's
 *     own factory-without-perimeter imbalance kills them, not the table's total
 *     factory-spam. The EliminationCause name is a stable identifier (the "18"/
 *     "shared" in the name is historical; the trigger is now per-player controlled).
 *  3. noIron — P has ≥1 base but controls no iron.
 *
 * Self-destruct (emptyPerimeter): if an eliminated player's id === byPlayer AND the
 * computed cause is noIron, reclassify to emptyPerimeter and award NO bounty
 * (self-inflicted on placing a 4th base enclosing no iron). All other eliminations
 * award bounty to byPlayer (if byPlayer != null, != P, and not eliminated):
 * full→12, half→6, none→0.
 *
 * MODELING NOTE (M1): the per-player 12 cap does NOT block bounty — basesInHand may
 * exceed 12, per the rulebook's "+12 when you eliminate a player". Bases of an
 * eliminated player leave play (removed from state.bases); board/iron unchanged.
 */
export function applyEliminations(
  state: GameState,
  byPlayer: PlayerId | null,
): { state: GameState; events: GameEvent[] } {
  const threshold = state.config.brokenPerimeterDeathAtFactories;

  // First pass over the INCOMING set: decide eliminations from the unchanged state.
  // (No cascade within a call — the driver re-invokes as the board changes.)
  type PreCause = "noBases" | "brokenPerimeterAt18Factories" | "noIron";
  const decided: { id: PlayerId; cause: PreCause }[] = [];

  for (const p of state.players) {
    if (p.eliminated) continue;
    const baseCount = state.bases.filter((b) => b.owner === p.id).length;

    if (baseCount === 0) {
      decided.push({ id: p.id, cause: "noBases" });
      continue;
    }
    // PER-PLAYER broken-perimeter clock: a <4-base player is eliminated once it
    // controls >= threshold factories (its own industry-without-territory), keyed
    // on this player's controlled factories rather than the shared placed pool.
    const ctl = control(state, p.id);
    if (baseCount < 4 && ctl.factories.length >= threshold) {
      decided.push({ id: p.id, cause: "brokenPerimeterAt18Factories" });
      continue;
    }
    // Under variant (a)/(c) (`noIronRequiresPerimeter`), the `noIron` cause is
    // gated on PERIMETER regime: a radiating player (<4 bases or degenerate hull)
    // with 0 iron is spared the elimination. Default false preserves the universal
    // "≥1 base + 0 iron = noIron" rule.
    if (ctl.iron.length === 0 && (!state.config.noIronRequiresPerimeter || ctl.perimeter)) {
      decided.push({ id: p.id, cause: "noIron" });
      continue;
    }
    // Otherwise P survives this pass.
  }

  if (decided.length === 0) {
    return { state, events: [] };
  }

  const eliminatedThisPass = new Set<PlayerId>(decided.map((d) => d.id));
  // byPlayer earns bounty only if it is not itself eliminated this pass and exists.
  const byPlayerLive =
    byPlayer !== null &&
    state.players.some((p) => p.id === byPlayer) &&
    !state.players.find((p) => p.id === byPlayer)!.eliminated &&
    !eliminatedThisPass.has(byPlayer);

  // Build new players array (immutably) and accumulate bounty.
  let players: Player[] = state.players.map((p) => ({ ...p, alliance: [...p.alliance] }));
  const events: GameEvent[] = [];
  let bountyTotal = 0;

  for (const d of decided) {
    let cause: EliminationCause = d.cause;
    // Self-destruct reclassification: noIron caused by the player's own move.
    if (d.cause === "noIron" && byPlayer !== null && byPlayer === d.id) {
      cause = "emptyPerimeter";
    }

    const awardsBounty =
      cause !== "emptyPerimeter" && byPlayerLive && byPlayer !== null && byPlayer !== d.id;

    if (awardsBounty) bountyTotal += bountyCount(state.config.killBounty);

    players = players.map((p) => (p.id === d.id ? { ...p, eliminated: true } : p));
    events.push({
      kind: "eliminated",
      player: d.id,
      cause,
      bountyTo: awardsBounty ? byPlayer : null,
    });
  }

  if (bountyTotal > 0 && byPlayer !== null) {
    players = players.map((p) =>
      p.id === byPlayer ? { ...p, basesInHand: p.basesInHand + bountyTotal } : p,
    );
  }

  // Remove eliminated players' bases from play (board/iron unchanged).
  const bases = state.bases.filter((b) => !eliminatedThisPass.has(b.owner));

  const newState: GameState = { ...state, players, bases };
  return { state: newState, events };
}
