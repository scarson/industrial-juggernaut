// ABOUTME: applyAction — the engine's pure state-transition function (spec §4/§8).
// ABOUTME: Task 5.3 implements the build branch; attack lands in Task 5.4. Returns a NEW state, never mutates input.

import { buildBudget, isLegalBasePlacement, isLegalFactoryPlacement } from "./build";
import type { Action, Base, Factory, GameEvent, GameState, PlayerId } from "./types";

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
      throw new Error("applyAction: attack branch implemented in Task 5.4");
  }
}
