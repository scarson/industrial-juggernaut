// ABOUTME: DEV-ONLY. Drives the pure agent-free engine to two 6-player scenes (radiating disks and a
// ABOUTME: perimetered hull + overlap) for the /dev board smoke page. Not a product route; replaced by P2's viewer.
import {
  initGame,
  placeFirstBase,
  legalFirstBaseHexes,
  legalActions,
  applyAction,
  advanceRound,
  defaultConfig,
} from "../../engine-client/barrel";
import { hexKey } from "../projection";
import type { GameState, Action, Hex } from "../../engine-client/barrel";

// Prefers a "build" action so the scene accrues factories and bases (skips attacks/pass for a
// calmer, denser eyeball state). Falls back to the first legal action otherwise.
function pickAction(actions: Action[]): Action | undefined {
  const build = actions.find((a) => a.kind === "build");
  return build ?? actions[0];
}

/** The canonical hexKeys of the first `n` bases — a synthetic stranded set for the eyeball. */
export function firstNBaseKeys(state: GameState, n: number): Set<string> {
  return new Set(state.bases.slice(0, n).map((b) => hexKey(b.hex)));
}

/** Force the base at `idx` to fatigued (immutable clone) so the smoke page shows the variant. */
export function withFatiguedBase(state: GameState, idx: number): GameState {
  return {
    ...state,
    bases: state.bases.map((b, i) => (i === idx ? { ...b, state: "fatigued" as const } : b)),
  };
}

/**
 * An EARLY-game 6-player state where every player is RADIATING (each holds 1-2 bases, below the
 * 4-base perimeter threshold — so every player's territory is a radius disk, never a hull). Built
 * on a wider ~149-hex board (size 150) than the default so the disks separate into a mix of
 * single-controller washes and contested overlap zones instead of one board-wide blur.
 *
 * Fully engine-driven and deterministic (seed 7, fixed placement stride, build-preferring turns) —
 * no structural overrides. Same seed, same board, same scene every load.
 */
export function devRadiatingState(): GameState {
  let state = initGame({
    seed: 7n,
    boardSource: { kind: "generate", size: 150, ironCount: 14 },
    nPlayers: 6,
    config: defaultConfig(),
  });

  while (state.phase.turn === 0) {
    const player = state.phase.order[state.phase.indexInOrder]!;
    const legal = legalFirstBaseHexes(state);
    const idx = (player * 5) % legal.length;
    state = placeFirstBase(state, player, legal[idx]!);
  }

  for (let i = 0; i < 24; i++) {
    const action = pickAction(legalActions(state));
    if (action !== undefined) state = applyAction(state, action).state;
    state = advanceRound(state);
  }

  return state;
}

// Snaps a target cube hex to the nearest on-board hex (cube distance). The generated board is an
// irregular blob, not a regular hexagon, so hand-authored hull/overlap coordinates are snapped
// onto real board hexes rather than assumed on-board.
function snapToBoard(state: GameState, target: Hex): Hex {
  let best = state.board.hexes[0]!;
  let bestDist = Infinity;
  for (const h of state.board.hexes) {
    const d = (Math.abs(h.x - target.x) + Math.abs(h.y - target.y) + Math.abs(h.z - target.z)) / 2;
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
}

const HEX = (x: number, z: number): Hex => ({ x, y: -x - z, z });

/**
 * A LATER-game state where at least one player is PERIMETERED and at least one overlap zone is
 * visible. Player 0 holds a wide 4-base diamond hull (crossing the 4-base perimeter threshold —
 * ~39 of its controlled hexes lie beyond every base's radius-5 disk, i.e. they are controlled ONLY
 * by the perimeter regime, confirming a true hull fill). Player 1's two eastern bases and player
 * 2's lone southwestern base radiate disks; player 1's disks reach into player 0's hull edge,
 * producing contested overlap hexes (~32 on this board).
 *
 * Built on a wide ~295-hex board (size 300) to exercise the large-scale legibility case, and via
 * DOCUMENTED structural overrides: the setup path only ever produces outer-ring 1-base radiating
 * layouts, so driving four non-colinear bases into a hull through legal actions would take a long
 * build sequence for no extra structural fidelity. The board itself is real (engine-generated); only
 * the base layout is authored. Target coordinates are snapped onto real board hexes.
 */
export function devPerimeteredState(): GameState {
  const base = initGame({
    seed: 7n,
    boardSource: { kind: "generate", size: 300, ironCount: 20 },
    nPlayers: 6,
    config: defaultConfig(),
  });

  const p0Hull = [HEX(0, -7), HEX(0, 7), HEX(9, -2), HEX(-9, 2)].map((h) => snapToBoard(base, h));
  const p1Pair = [HEX(9, -6), HEX(11, -6)].map((h) => snapToBoard(base, h));
  const p2Lone = [HEX(-8, 7)].map((h) => snapToBoard(base, h));

  return {
    ...base,
    phase: { ...base.phase, turn: 1 },
    bases: [
      ...p0Hull.map((hex, i) => ({ owner: 0 as const, hex, state: "fresh" as const, order: i })),
      ...p1Pair.map((hex, i) => ({ owner: 1 as const, hex, state: "fresh" as const, order: i })),
      ...p2Lone.map((hex, i) => ({ owner: 2 as const, hex, state: "fresh" as const, order: i })),
    ],
  };
}
