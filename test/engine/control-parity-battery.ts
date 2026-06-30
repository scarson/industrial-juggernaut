// ABOUTME: Shared state battery + canonical serializer for the control() parity oracle (crafted edge cases + seeded full-game snapshots).
// ABOUTME: Used by both scripts/control-parity-capture.ts (golden capture) and test/engine/control-parity.test.ts (assertion).

import { generateBoard } from "../../src/board/generate";
import { control } from "../../src/engine/control";
import { defaultConfig } from "../../src/engine/config";
import { key } from "../../src/geometry/cube";
import { stepRound } from "../../src/engine/round";
import { status } from "../../src/engine/status";
import { advanceRound, currentPlayer, setupGame } from "../../src/engine/turn";
import { greedyAgent, type Agent } from "../../src/agent/agent";
import { heuristicAgent } from "../../src/agent/heuristic-agent";
import { seed } from "../../src/rng/pcg";
import type { Archetype } from "../../src/agent/archetypes";
import { mkState } from "../helpers/state";
import type { GameState, Hex, PlayerId } from "../../src/engine/types";

const hex = (x: number, y: number, z: number): Hex => ({ x, y, z });

/** A control() result reduced to an ORDER-INDEPENDENT, machine-comparable form. */
export interface CanonicalControl {
  hexes: string[]; // sorted canonical "x,y,z"
  iron: string[]; // sorted canonical "x,y,z"
  factories: string[]; // sorted canonical "x,y,z"
}

export interface GoldenCase {
  name: string;
  player: PlayerId;
  // Stable 64-bit FNV-1a hex digest of the canonical control output (controlHash).
  // The full hex/iron/factory lists are NOT stored — a single hash per state keeps
  // the 1269-state regression coverage while shrinking the golden ~80x. The
  // tradeoff: a mismatch localizes to a STATE (by name), not to the exact hex that
  // moved. FNV-1a (not a crypto hash) keeps the test/engine layer Node-free — no
  // `node:crypto`, no `@types/node` surface — and is deterministic and ample for
  // drift detection over 1269 bounded states (collision probability ~1e-13).
  hash: string;
}

interface BatteryCase {
  name: string;
  state: GameState;
  player: PlayerId;
}

/**
 * Canonicalize control()'s output: sort every collection by its canonical hex
 * key so the comparison is order-independent. `hexes` is already a Set (reach);
 * `iron`/`factories` are arrays whose membership — not order — is the contract.
 */
export function canonicalControl(state: GameState, player: PlayerId): CanonicalControl {
  const ctl = control(state, player);
  return {
    hexes: [...ctl.hexes].sort(),
    iron: ctl.iron.map(key).sort(),
    factories: ctl.factories.map(key).sort(),
  };
}

/**
 * Stable 64-bit FNV-1a hex digest of the canonical control output. The three
 * sorted lists are joined with delimiters that can never appear inside a "x,y,z"
 * key (`|` between members, `;` between sections), so distinct outputs never
 * collide on serialization. Deterministic and order-independent (the lists are
 * sorted), exactly like the prior full-list comparison — only what's stored
 * changes. Pure TS (no `node:crypto`) so the test/engine layer stays Node-free.
 */
const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function controlHash(c: CanonicalControl): string {
  const serialized = `${c.hexes.join("|")};${c.iron.join("|")};${c.factories.join("|")}`;
  // 64-bit FNV-1a in BigInt — exact, simple, and fast enough (one-time capture
  // + per-test recompute over ~1269 short strings; performance is irrelevant).
  let h = FNV64_OFFSET;
  for (let i = 0; i < serialized.length; i++) {
    h = (h ^ BigInt(serialized.charCodeAt(i) & 0xff)) & MASK64;
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * CRAFTED edge cases — each one pins a specific regime or boundary the seeded
 * games may under-sample: empty/single-base, exact-radius edge, colinear-hull
 * fallback (R3), perimeter interior, DER #17 exclusion (iron + factory), ally
 * perimeter keeping the resource, and mixed radiating-vs-perimeter on one board.
 */
function craftedCases(): BatteryCase[] {
  const cases: BatteryCase[] = [];

  // Empty board-player (no bases): radiating regime, no hexes.
  cases.push({
    name: "crafted/empty-no-bases",
    state: mkState({ board: 96, basesP0: [] }),
    player: 0,
  });

  // Single base — radiating disk, with iron on the exact radius edge and just beyond.
  cases.push({
    name: "crafted/single-base-radius-edge",
    state: mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(5, -5, 0), hex(6, -6, 0), hex(0, 0, 0)],
      factories: [hex(3, -3, 0), hex(6, 0, -6)],
    }),
    player: 0,
  });

  // Two & three radiating bases (overlapping disks shared, not subtracted).
  cases.push({
    name: "crafted/two-radiating-bases",
    state: mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(8, -8, 0)],
      iron: [hex(4, -4, 0), hex(2, -2, 0)],
    }),
    player: 0,
  });
  cases.push({
    name: "crafted/three-radiating-bases",
    state: mkState({
      board: 220,
      basesP0: [hex(0, 0, 0), hex(6, -6, 0), hex(-6, 6, 0)],
      iron: [hex(3, -3, 0), hex(-3, 3, 0)],
      factories: [hex(0, 0, 0), hex(5, -5, 0)],
    }),
    player: 0,
  });

  // Four bases forming a real hull — perimeter regime.
  cases.push({
    name: "crafted/perimeter-square",
    state: mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)],
      iron: [hex(2, -2, 0), hex(2, 0, -2)],
      factories: [hex(2, -1, -1)],
    }),
    player: 0,
  });

  // Colinear 4 bases — degenerate hull (R3) falls back to radiating.
  cases.push({
    name: "crafted/colinear-4-bases-R3",
    state: mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0), hex(3, -3, 0)],
      iron: [hex(0, 4, -4), hex(2, -2, 0)],
    }),
    player: 0,
  });

  // DER #17: radiating p0 disk overlaps the interior of non-ally p1's perimeter.
  // The interior iron AND factory must be excluded for p0 but kept by p1.
  {
    const ironHex = hex(0, 0, 0);
    const facHex = hex(1, -1, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const p0Base = hex(5, 0, -5);
    const s = mkState({
      board: 96,
      basesP0: [p0Base],
      basesP1: p1Bases,
      iron: [ironHex, hex(5, -5, 0)],
      factories: [facHex, hex(4, 0, -4)],
    });
    cases.push({ name: "crafted/der17-radiating-excludes/p0", state: s, player: 0 });
    cases.push({ name: "crafted/der17-radiating-excludes/p1", state: s, player: 1 });
  }

  // DER #17 ally case: same geometry but p0 and p1 are allied — no subtraction.
  {
    const ironHex = hex(0, 0, 0);
    const facHex = hex(1, -1, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const p0Base = hex(5, 0, -5);
    const base = mkState({
      board: 96,
      basesP0: [p0Base],
      basesP1: p1Bases,
      iron: [ironHex, hex(5, -5, 0)],
      factories: [facHex],
    });
    const s: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.id === 0 ? { ...p, alliance: [0, 1] } : p.id === 1 ? { ...p, alliance: [1, 0] } : p,
      ),
    };
    cases.push({ name: "crafted/der17-ally-keeps/p0", state: s, player: 0 });
  }

  // DER #17 with an ELIMINATED perimeter owner: eliminated opponents do NOT subtract.
  {
    const ironHex = hex(0, 0, 0);
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const p0Base = hex(5, 0, -5);
    const base = mkState({ board: 96, basesP0: [p0Base], basesP1: p1Bases, iron: [ironHex] });
    const s: GameState = {
      ...base,
      players: base.players.map((p) => (p.id === 1 ? { ...p, eliminated: true } : p)),
    };
    cases.push({ name: "crafted/der17-eliminated-owner-no-subtract/p0", state: s, player: 0 });
  }

  // MIXED on one board: p0 radiating, p1 perimeter, p2 radiating — all 3 players
  // (player counts up to the declared max). Captures each player's view.
  {
    const p1Bases = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2)];
    const s = mkState({
      board: 220,
      basesP0: [hex(6, 0, -6)],
      basesP1: p1Bases,
      basesP2: [hex(-7, 7, 0), hex(-5, 5, 0)],
      iron: [hex(0, 0, 0), hex(1, -1, 0), hex(-6, 6, 0), hex(8, -8, 0)],
      factories: [hex(0, 1, -1), hex(-5, 6, -1)],
    });
    cases.push({ name: "crafted/mixed-radiating-perimeter/p0", state: s, player: 0 });
    cases.push({ name: "crafted/mixed-radiating-perimeter/p1", state: s, player: 1 });
    cases.push({ name: "crafted/mixed-radiating-perimeter/p2", state: s, player: 2 });
  }

  return cases;
}

/**
 * SYSTEMATIC perimeter + DER #17 coverage — the seeded greedy games rarely reach
 * the perimeter regime (they win on iron first), so this generator pins the
 * convex-hull branch and the radiating-vs-perimeter exclusion deterministically
 * across many hull shapes, sizes, board scales, and overlap configurations.
 */
function craftedPerimeterCases(): BatteryCase[] {
  const cases: BatteryCase[] = [];

  // A family of hulls of growing size, each on both boards, with iron+factories
  // strewn inside and outside. Pins the perimeter-interior branch directly.
  const hullSizes = [2, 3, 4, 5, 6, 7];
  for (const boardSize of [96, 220, 300]) {
    for (const r of hullSizes) {
      // Diamond hull with vertices at +/-r on two axes (positive area for r>=1).
      const hullBases = [hex(r, -r, 0), hex(-r, r, 0), hex(r, 0, -r), hex(-r, 0, r)];
      // Iron/factories at the centre, near a vertex, on an edge midpoint, and outside.
      const iron = [hex(0, 0, 0), hex(1, -1, 0), hex(r - 1, -(r - 1), 0), hex(r + 2, -(r + 2), 0)];
      const factories = [hex(0, 1, -1), hex(r - 1, 1, -r), hex(r + 3, 0, -(r + 3))];
      const s = mkState({ board: boardSize, basesP0: hullBases, iron, factories });
      cases.push({ name: `craftedperim/b${boardSize}/diamond-r${r}/p0`, state: s, player: 0 });
    }
  }

  // Pentagon / hexagon-ish hulls (5 and 6 bases) — non-degenerate, more edges.
  for (const boardSize of [220, 300]) {
    const penta = [hex(0, -5, 5), hex(5, -5, 0), hex(5, 0, -5), hex(0, 5, -5), hex(-5, 3, 2)];
    const hexa = [
      hex(0, -6, 6), hex(6, -6, 0), hex(6, 0, -6),
      hex(0, 6, -6), hex(-6, 6, 0), hex(-6, 0, 6),
    ];
    const iron = [hex(0, 0, 0), hex(2, -2, 0), hex(-2, 2, 0), hex(3, 0, -3), hex(8, -8, 0)];
    const factories = [hex(1, 1, -2), hex(-3, 1, 2), hex(7, 0, -7)];
    cases.push({
      name: `craftedperim/b${boardSize}/pentagon/p0`,
      state: mkState({ board: boardSize, basesP0: penta, iron, factories }),
      player: 0,
    });
    cases.push({
      name: `craftedperim/b${boardSize}/hexagon/p0`,
      state: mkState({ board: boardSize, basesP0: hexa, iron, factories }),
      player: 0,
    });
  }

  // DER #17 overlap matrix: a radiating p0 base placed at varying distances from
  // a perimetered p1 hull, with iron+factories inside, on the edge, and outside
  // p1's hull. Captures BOTH players' views in every combination, plus an allied
  // variant per case (ally must NOT subtract).
  const p1Hull = [hex(3, -3, 0), hex(-3, 3, 0), hex(3, 0, -3), hex(-3, 0, 3)];
  const p0Positions = [hex(7, 0, -7), hex(0, 7, -7), hex(-7, 7, 0), hex(8, -8, 0)];
  for (const boardSize of [96, 220]) {
    for (let i = 0; i < p0Positions.length; i++) {
      const p0Base = p0Positions[i]!;
      const iron = [hex(0, 0, 0), hex(1, -1, 0), hex(-1, 1, 0), hex(3, -3, 0), hex(6, -6, 0)];
      const factories = [hex(0, 1, -1), hex(2, -1, -1), hex(7, -1, -6)];
      const base = mkState({ board: boardSize, basesP0: [p0Base], basesP1: p1Hull, iron, factories });
      cases.push({ name: `craftedperim/der-matrix/b${boardSize}/pos${i}/p0`, state: base, player: 0 });
      cases.push({ name: `craftedperim/der-matrix/b${boardSize}/pos${i}/p1`, state: base, player: 1 });

      const allied: GameState = {
        ...base,
        players: base.players.map((p) =>
          p.id === 0 ? { ...p, alliance: [0, 1] } : p.id === 1 ? { ...p, alliance: [1, 0] } : p,
        ),
      };
      cases.push({ name: `craftedperim/der-matrix/b${boardSize}/pos${i}/ally-p0`, state: allied, player: 0 });
    }
  }

  return cases;
}

const ARCHS: Archetype[] = ["aggressive", "economic", "expansionist"];

/**
 * SEEDED full-game snapshots — play deterministic greedy games (n=2..6, boards
 * 96/220/300) and snapshot control() for EVERY player at EVERY turn boundary.
 * This naturally produces the full distribution: radiating-only early, perimeter
 * mid-game, mixed regimes, and real DER #17 overlaps — far more states than the
 * crafted set, on real boards.
 */
function seededCases(): BatteryCase[] {
  const cases: BatteryCase[] = [];
  // Raise the iron victory threshold so games do not end on a turn-1/2 iron win
  // before perimeters form — this pushes real games into the perimeter regime
  // and produces genuine DER #17 overlaps mid-game.
  const config = { ...defaultConfig(), victoryThreshold: 40 };
  const boards = [96, 220, 300];
  const profiles: ReadonlyArray<"greedy" | "heuristic"> = ["greedy", "heuristic"];

  let caseSeed = 0;
  for (const boardSize of boards) {
    for (const profile of profiles) {
      for (let i = 0; i < 12; i++) {
        const n = 2 + (i % 5); // 2..6
        const gameSeed = BigInt(caseSeed++);
        let rng = seed(gameSeed);
        const g = generateBoard(rng, { size: boardSize, ironCount: config.ironCount });
        rng = g.rng;
        let state: GameState = setupGame(rng, g.board, n, config);
        const archetypes = Array.from({ length: n }, (_, k) => ARCHS[k % ARCHS.length]!);
        const agents: Agent[] =
          profile === "greedy"
            ? archetypes.map((a) => greedyAgent(a))
            : Array.from({ length: n }, () => heuristicAgent());

        const snapshot = (s: GameState, tag: string) => {
          for (const pl of s.players) {
            cases.push({
              name: `seeded/${profile}/b${boardSize}/seed${gameSeed}/n${n}/${tag}/p${pl.id}`,
              state: s,
              player: pl.id,
            });
          }
        };

        // Snapshot at setup, then at each turn boundary, capped to keep the battery bounded.
        let snapCount = 0;
        const MAX_SNAPS = 10;
        snapshot(state, `t${state.phase.turn}-s${snapCount}`);
        snapCount++;

        if (status(state).kind !== "ongoing") {
          continue; // born-terminal: setup snapshot is enough
        }

        for (;;) {
          const p = currentPlayer(state);
          if (!state.players[p]!.eliminated) {
            const choice = agents[p]!(state, p);
            state = stepRound(choice.state, choice.action).state;
          }
          if (status(state).kind === "victory") break;

          const before = state.phase.turn;
          state = advanceRound(state);
          if (state.phase.turn !== before) {
            if (snapCount < MAX_SNAPS) {
              snapshot(state, `t${state.phase.turn}-s${snapCount}`);
              snapCount++;
            }
            if (state.phase.turn > 20) break; // bound to realistic mid-games (avoid degenerate ultra-long tails)
          }
        }
      }
    }
  }

  return cases;
}

/** The full parity battery: crafted edge cases, systematic perimeter/DER coverage, then seeded full-game snapshots. */
export function buildBattery(): BatteryCase[] {
  return [...craftedCases(), ...craftedPerimeterCases(), ...seededCases()];
}
