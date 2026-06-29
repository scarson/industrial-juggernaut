// ABOUTME: One-off investigation script for DER #17 (overlapping iron double-count). NOT production; deleted after.
// ABOUTME: Mirrors src/driver/run.ts's loop, instrumenting per-boundary overlap + a victory counterfactual under exclusive control.

import { greedyAgent, type Agent } from "../src/agent/agent";
import { heuristicAgent } from "../src/agent/heuristic-agent";
import { generateBoard } from "../src/board/generate";
import { control } from "../src/engine/control";
import { stepRound } from "../src/engine/round";
import { status } from "../src/engine/status";
import { advanceRound, currentPlayer, setupGame } from "../src/engine/turn";
import { seed } from "../src/rng/pcg";
import { defaultConfig } from "../src/engine/config";
import { convexHull, hexInHull, hullArea } from "../src/geometry/hull";
import { distance, key } from "../src/geometry/cube";
import type { Archetype } from "../src/agent/archetypes";
import type { GameState, Hex, PlayerId } from "../src/engine/types";

const PERIMETER_BASE_COUNT = 4;

/** A player's valid perimeter hull (>=4 bases, positive area), else null — mirrors control.ts. */
function validHull(state: GameState, p: PlayerId): Hex[] | null {
  const bases = state.bases.filter((b) => b.owner === p);
  if (bases.length < PERIMETER_BASE_COUNT) return null;
  const hull = convexHull(bases.map((b) => b.hex));
  return hullArea(hull) > 0 ? hull : null;
}

/**
 * The PRE-FIX radiating-disk iron for player p, computed independently of production
 * control() so the detector can witness the overlap gap even after control() enforces
 * exclusivity. Perimetered players are unaffected by the DER #17 fix, so for them this
 * equals control().iron; for radiating players it is the raw radius-disk iron with NO
 * exclusion (what control() returned BEFORE the fix).
 */
function rawRadiatingIron(state: GameState, p: PlayerId): Hex[] {
  if (validHull(state, p)) return control(state, p).iron; // perimetered: unchanged by the fix
  const bases = state.bases.filter((b) => b.owner === p);
  const r = state.config.radius;
  return state.board.iron.filter((h) => bases.some((b) => distance(b.hex, h) <= r));
}

/**
 * EXCLUSIVE iron per player under the DER #17 rule "a perimeter claims its interior
 * iron exclusively from adjacent radiating players": a radiating player does NOT count
 * an iron hex that lies inside a (non-ally) opponent's valid perimeter. A perimetered
 * player keeps all its hull iron. Radiating-vs-radiating overlap is unchanged (the rule
 * only addresses the perimeter boundary).
 */
function exclusiveIronCount(state: GameState, p: PlayerId): number {
  const myHull = validHull(state, p);
  const ally = state.players[p]!.alliance;
  // Opponent valid hulls (non-ally).
  const oppHulls: Hex[][] = [];
  for (const q of state.players) {
    if (ally.includes(q.id)) continue;
    const h = validHull(state, q.id);
    if (h) oppHulls.push(h);
  }
  const stdIron = rawRadiatingIron(state, p);
  if (myHull) return stdIron.length; // perimetered claimer keeps everything
  // radiating: drop iron that sits inside any opponent's perimeter
  let n = 0;
  for (const h of stdIron) {
    const claimedByOpp = oppHulls.some((hull) => hexInHull(h, hull));
    if (!claimedByOpp) n++;
  }
  return n;
}

/** Per turn-boundary overlap snapshot: how much iron is shared by >=2 non-ally players (standard control). */
function overlapSnapshot(state: GameState): { sharedIronHexes: number; playersSharing: number; totalControlledIronInstances: number } {
  // Map each iron hex -> set of (solo) players controlling it under standard control.
  const owners = new Map<string, Set<PlayerId>>();
  for (const pl of state.players) {
    for (const h of rawRadiatingIron(state, pl.id)) {
      const k = key(h);
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k)!.add(pl.id);
    }
  }
  let sharedIronHexes = 0;
  const sharers = new Set<PlayerId>();
  let totalInstances = 0;
  for (const [, set] of owners) {
    totalInstances += set.size;
    if (set.size >= 2) {
      sharedIronHexes++;
      for (const p of set) sharers.add(p);
    }
  }
  return { sharedIronHexes, playersSharing: sharers.size, totalControlledIronInstances: totalInstances };
}

/**
 * The EXACT DER #17 bug condition per state: iron-hex instances where a RADIATING player
 * controls an iron hex that lies inside a non-ally PERIMETERED opponent's hull (the iron the
 * exclusive rule would subtract). Returns total such instances + whether any occurred.
 */
function derSubtractableSnapshot(state: GameState): number {
  let n = 0;
  for (const pl of state.players) {
    if (validHull(state, pl.id)) continue; // perimetered players are claimers, not subtractees
    const ally = state.players[pl.id]!.alliance;
    const oppHulls: Hex[][] = [];
    for (const q of state.players) {
      if (ally.includes(q.id)) continue;
      const h = validHull(state, q.id);
      if (h) oppHulls.push(h);
    }
    if (!oppHulls.length) continue;
    for (const h of rawRadiatingIron(state, pl.id)) {
      if (oppHulls.some((hull) => hexInHull(h, hull))) n++;
    }
  }
  return n;
}

/**
 * SELF-TEST: prove the detector CAN fire (so the always-0 real-game result is trustworthy,
 * not a measurement bug). Build a state where p1 perimeters a hull enclosing an iron hex and
 * p0 (radiating) has a base within radius 5 of that interior iron from OUTSIDE the perimeter.
 */
function selfTest(): boolean {
  const hex = (x: number, y: number, z: number): Hex => ({ x, y, z });
  const ironHex = hex(0, 0, 0);
  const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)]; // hull around origin
  const p0Base = hex(5, 0, -5); // dist to origin = 5 (<= radius 5), outside p1's hull
  const boardHexes = [ironHex, ...p1Bases, p0Base, hex(1, -1, 0), hex(0, 1, -1), hex(-1, 0, 1)];
  const cfg = defaultConfig();
  const st: GameState = {
    board: { hexes: boardHexes, iron: [ironHex] },
    bases: [
      { owner: 0, hex: p0Base, state: "fresh", order: 0 },
      ...p1Bases.map((h, i) => ({ owner: 1 as PlayerId, hex: h, state: "fresh" as const, order: i })),
    ],
    factories: [],
    players: [
      { id: 0, basesInHand: 11, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 8, alliance: [1], eliminated: false },
    ],
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    factorySupply: cfg.factorySupply,
    config: cfg,
    rngState: seed(1n),
  };
  const hull = validHull(st, 1);
  const p0Ctl = rawRadiatingIron(st, 0).map(key);
  const der = derSubtractableSnapshot(st);
  const excl0 = exclusiveIronCount(st, 0);
  const std0 = rawRadiatingIron(st, 0).length;
  const ok = hull !== null && hexInHull(ironHex, hull) && p0Ctl.includes(key(ironHex)) && der >= 1 && excl0 < std0;
  console.log(`[self-test] p1 perimetered=${hull !== null}, origin-in-hull=${hull ? hexInHull(ironHex, hull) : false}, p0 controls iron=${p0Ctl.includes(key(ironHex))}, derSubtractable=${der}, p0 std=${std0} excl=${excl0} => ${ok ? "PASS (detector fires)" : "FAIL (detector broken — results untrustworthy)"}`);
  return ok;
}

const useHeuristic = process.argv.includes("--heuristic");
const inspectArg = process.argv.find((a) => a.startsWith("--inspect="));
if (inspectArg) {
  // Deep-dive a single game to verify the mechanism end-to-end.
  const sd = BigInt(inspectArg.split("=")[1]!);
  const n = 2 + (Number(sd) % 5);
  const cfg = defaultConfig();
  let rng = seed(sd); const g = generateBoard(rng, { size: cfg.boardSize, ironCount: cfg.ironCount }); rng = g.rng;
  let state = setupGame(rng, g.board, n, cfg);
  const agents: Agent[] = Array.from({ length: n }, (_, k) => heuristicAgent());
  for (;;) {
    const p = currentPlayer(state);
    if (!state.players[p]!.eliminated) { const c = agents[p]!(state, p); state = stepRound(c.state, c.action).state; }
    const st = status(state);
    if (st.kind === "victory") {
      console.log(`seed=${sd} n=${n}: VICTORY reason=${st.reason} winners=${JSON.stringify(st.players)} at turn ${state.phase.turn}`);
      for (const pl of state.players) {
        const bc = state.bases.filter((b) => b.owner === pl.id).length;
        const hull = validHull(state, pl.id);
        console.log(`  player ${pl.id}: bases=${bc} perimetered=${hull !== null} stdIron=${control(state, pl.id).iron.length} eliminated=${pl.eliminated}`);
      }
      for (const w of st.players) {
        const hull = validHull(state, w);
        const ironInOpp = control(state, w).iron.filter((h) => state.players.some((q) => !state.players[w]!.alliance.includes(q.id) && (() => { const oh = validHull(state, q.id); return oh ? hexInHull(h, oh) : false; })()));
        console.log(`  WINNER ${w}: perimetered=${hull !== null}, of ${control(state, w).iron.length} controlled iron, ${ironInOpp.length} sit INSIDE a non-ally opponent's perimeter (would be subtracted)`);
      }
      break;
    }
    const before = state.phase.turn; state = advanceRound(state);
    if (state.phase.turn !== before && state.phase.turn > 300) { console.log(`seed=${sd}: turn cap`); break; }
  }
  process.exit(0);
}
const archs: Archetype[] = ["aggressive", "economic", "expansionist"];
const config = defaultConfig();
const THRESHOLD = config.victoryThreshold;
const N_GAMES = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 500);

// Validate the detector before trusting any 0-result.
if (!selfTest()) { console.error("ABORT: detector self-test failed; measurements would be meaningless."); process.exit(1); }
console.log(`agent profile: ${useHeuristic ? "heuristic" : "greedy (aggressive/economic/expansionist)"}\n`);

// Aggregates.
let games = 0, ironWins = 0, lastStandingWins = 0, noneWins = 0, capHits = 0;
let boundaries = 0, boundariesWithSharing = 0, sumSharedIronHexes = 0;
let maxSharedIronHexesEver = 0;
let boundariesWithDerBug = 0, sumDerSubtractable = 0, maxDerSubtractable = 0;
// Victory counterfactual.
let bornTerminalIronWins = 0, playedOutIronWins = 0;
let ironWinsOverlapAssisted = 0; // played-out winner's EXCLUSIVE iron < threshold at victory
let sumWinnerStdIron = 0, sumWinnerExclIron = 0; // over played-out iron wins
let radiatingWinnerOverlapAssisted = 0; // overlap-assisted win where the winner is itself radiating (the exploit)
let flipRightfulWinnerExists = 0; // a DIFFERENT player has >=threshold EXCLUSIVE iron (clear winner flip)
let flipGameWouldContinue = 0;   // no one has >=threshold exclusive iron (false victory; game would play on)
const overlapAssistedExamples: string[] = [];

/** Max EXCLUSIVE distinct iron over solo players (and the leader id). */
function exclusiveLeader(state: GameState, exclude: PlayerId[]): { id: PlayerId; count: number } {
  let best = { id: -1 as PlayerId, count: -1 };
  for (const pl of state.players) {
    if (exclude.includes(pl.id) || pl.eliminated) continue;
    const c = winnerIron(state, [pl.id]).excl;
    if (c > best.count) best = { id: pl.id, count: c };
  }
  return best;
}

/** Coalition (std,excl) distinct iron at a victory state. */
function winnerIron(state: GameState, winners: PlayerId[]): { std: number; excl: number; winnerRadiating: boolean } {
  const stdSet = new Set<string>(), exclSet = new Set<string>();
  let anyRadiating = false;
  for (const m of winners) {
    const myHull = validHull(state, m);
    if (!myHull) anyRadiating = true;
    const ally = state.players[m]!.alliance;
    const oppHulls: Hex[][] = [];
    for (const q of state.players) {
      if (ally.includes(q.id)) continue;
      const hh = validHull(state, q.id);
      if (hh) oppHulls.push(hh);
    }
    for (const h of rawRadiatingIron(state, m)) {
      stdSet.add(key(h));
      if (myHull || !oppHulls.some((hull) => hexInHull(h, hull))) exclSet.add(key(h));
    }
  }
  return { std: stdSet.size, excl: exclSet.size, winnerRadiating: anyRadiating };
}

for (let i = 0; i < N_GAMES; i++) {
  const n = 2 + (i % 5); // 2..6, mirrors acceptance
  let rng = seed(BigInt(i));
  const g = generateBoard(rng, { size: config.boardSize, ironCount: config.ironCount });
  rng = g.rng;
  let state: GameState = setupGame(rng, g.board, n, config);
  const archetypes = Array.from({ length: n }, (_, k) => archs[k % archs.length]!);
  const agents: Agent[] = Array.from({ length: n }, (_, k) => useHeuristic ? heuristicAgent() : greedyAgent(archetypes[k]!));
  games++;

  const measureBoundary = (s: GameState) => {
    boundaries++;
    const snap = overlapSnapshot(s);
    if (snap.sharedIronHexes > 0) boundariesWithSharing++;
    sumSharedIronHexes += snap.sharedIronHexes;
    if (snap.sharedIronHexes > maxSharedIronHexesEver) maxSharedIronHexesEver = snap.sharedIronHexes;
    const der = derSubtractableSnapshot(s);
    if (der > 0) boundariesWithDerBug++;
    sumDerSubtractable += der;
    if (der > maxDerSubtractable) maxDerSubtractable = der;
  };

  // born-terminal check (mirror run.ts)
  let st0 = status(state);
  if (st0.kind === "victory") {
    if (st0.reason === "iron") { ironWins++; bornTerminalIronWins++; } else lastStandingWins++;
    continue; // born-terminal: at setup no perimeters exist, so excl==std — not DER-relevant
  }

  measureBoundary(state);
  let done = false;
  for (;;) {
    const p = currentPlayer(state);
    if (!state.players[p]!.eliminated) {
      const choice = agents[p]!(state, p);
      state = stepRound(choice.state, choice.action).state;
    }
    const st = status(state);
    if (st.kind === "victory") {
      if (st.reason === "iron") {
        ironWins++; playedOutIronWins++;
        const winners = st.players;
        const wi = winnerIron(state, winners);
        sumWinnerStdIron += wi.std;
        sumWinnerExclIron += wi.excl;
        if (wi.excl < THRESHOLD) {
          ironWinsOverlapAssisted++;
          if (wi.winnerRadiating) radiatingWinnerOverlapAssisted++;
          const lead = exclusiveLeader(state, winners);
          if (lead.count >= THRESHOLD) flipRightfulWinnerExists++; else flipGameWouldContinue++;
          if (overlapAssistedExamples.length < 12) {
            overlapAssistedExamples.push(`seed=${i} n=${n} turn=${state.phase.turn}: winner ${JSON.stringify(winners)} std=${wi.std} excl=${wi.excl}${wi.winnerRadiating ? " [RADIATING exploit]" : ""}; rightful excl-leader=p${lead.id}@${lead.count} (threshold ${THRESHOLD})`);
          }
        }
      } else lastStandingWins++;
      done = true;
      break;
    }
    const before = state.phase.turn;
    state = advanceRound(state);
    if (state.phase.turn !== before) {
      measureBoundary(state);
      if (state.phase.turn > 300) { capHits++; done = true; break; }
    }
  }
  void done;
}

noneWins = capHits;
console.log("=== DER #17 overlap measurement ===");
console.log(`games=${games} (n=2..6, archetypes aggressive/economic/expansionist, board 96/iron 14, threshold ${THRESHOLD})`);
console.log(`victory: iron=${ironWins} last-standing=${lastStandingWins} turn-cap(none)=${capHits}`);
console.log("");
console.log("--- Overlap prevalence (standard control, all turn boundaries) ---");
console.log(`turn-boundaries sampled: ${boundaries}`);
console.log(`boundaries with ANY shared iron (>=2 non-ally players on one iron hex): ${boundariesWithSharing} (${(100*boundariesWithSharing/boundaries).toFixed(2)}%)`);
console.log(`avg shared-iron-hexes per boundary: ${(sumSharedIronHexes/boundaries).toFixed(3)}`);
console.log(`max shared-iron-hexes in any single state: ${maxSharedIronHexesEver}`);
console.log("");
console.log("--- EXACT DER #17 bug condition (radiating player counting iron inside an opponent's PERIMETER) ---");
console.log(`boundaries where the bug fires (>=1 radiating-iron-in-opponent-perimeter): ${boundariesWithDerBug} (${(100*boundariesWithDerBug/boundaries).toFixed(2)}%)`);
console.log(`avg subtractable iron-instances per boundary: ${(sumDerSubtractable/boundaries).toFixed(4)}`);
console.log(`max subtractable iron-instances in any single state: ${maxDerSubtractable}`);
console.log("");
console.log("--- Victory counterfactual (does double-counting decide iron wins?) ---");
console.log(`iron victories: ${ironWins} = ${bornTerminalIronWins} born-terminal (1-base disk covers >=${THRESHOLD} iron at setup; no perimeters, not DER-relevant) + ${playedOutIronWins} played-out`);
console.log(`among PLAYED-OUT iron wins (${playedOutIronWins}):`);
console.log(`  avg winner STANDARD iron at victory: ${playedOutIronWins? (sumWinnerStdIron/playedOutIronWins).toFixed(2):"-"}`);
console.log(`  avg winner EXCLUSIVE iron at victory: ${playedOutIronWins? (sumWinnerExclIron/playedOutIronWins).toFixed(2):"-"}`);
console.log(`  OVERLAP-ASSISTED wins (winner's EXCLUSIVE iron < ${THRESHOLD} — win used iron inside opponents' perimeters): ${ironWinsOverlapAssisted} (${playedOutIronWins? (100*ironWinsOverlapAssisted/playedOutIronWins).toFixed(2):"-"}% of played-out iron wins)`);
console.log(`    of which the WINNER is itself radiating (the blanket-coverage EXPLOIT): ${radiatingWinnerOverlapAssisted}`);
console.log(`    CLEAR WINNER FLIP (a different player already has >=${THRESHOLD} EXCLUSIVE iron — they'd win instead): ${flipRightfulWinnerExists}`);
console.log(`    false victory, game would continue (no one has >=${THRESHOLD} exclusive yet): ${flipGameWouldContinue}`);
if (overlapAssistedExamples.length) {
  console.log("  examples:");
  for (const e of overlapAssistedExamples) console.log("   ", e);
}
