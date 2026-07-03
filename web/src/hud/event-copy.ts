// ABOUTME: eventLine — turns one engine GameEvent into a single human sentence for the event log /
// ABOUTME: viewer narration. Numbers stay honest (committed counts, player labels); no raw discriminants.
import type { EliminationCause, GameEvent, PieceKind, PlayerId } from "../engine-client/barrel";

/**
 * Player labels are 1-based on screen ("Player 1".."Player 6") — the engine's 0-based `PlayerId`
 * is an internal index players never see. Kept as a single helper so every line agrees.
 */
function playerLabel(id: PlayerId): string {
  return `Player ${id + 1}`;
}

/** The noun for a placed piece, singular and lowercase for mid-sentence use. */
function pieceNoun(piece: PieceKind): string {
  return piece; // "factory" | "base" already read as English nouns
}

/**
 * Human phrasing for each elimination cause (spec §8). The raw camelCase discriminant never
 * reaches the screen — this is the whole point of the map. `emptyPerimeter` is self-inflicted.
 */
const CAUSE_PHRASE: Record<EliminationCause, string> = {
  noBases: "ran out of bases",
  brokenPerimeterAt18Factories: "broke their perimeter in the late game (18 factories placed)",
  noIron: "lost control of all iron",
  emptyPerimeter: "abandoned an empty perimeter",
};

/** Causes that never pay a bounty (spec §8: `emptyPerimeter` is self-inflicted). */
const NO_BOUNTY_CAUSES: ReadonlySet<EliminationCause> = new Set(["emptyPerimeter"]);

/**
 * Narrates a single engine event as one sentence. Exhaustive over the `GameEvent` union — a new
 * kind added to `src/engine/types.ts` without a case here fails the `switch`'s exhaustiveness check
 * (the `never` return), so the copy can never silently fall through to a placeholder.
 */
export function eventLine(event: GameEvent): string {
  switch (event.kind) {
    case "placed":
      return `${playerLabel(event.owner)} places a ${pieceNoun(event.piece)}.`;

    case "combat": {
      const outcome = event.attackerWon
        ? `wins and captures the target`
        : `loses — the defender holds`;
      return `Combat resolves: ${event.committed} committed, the attacker ${outcome}.`;
    }

    case "baseDestroyed":
      return `${playerLabel(event.owner)} loses a base — it is destroyed.`;

    case "baseReplaced":
      return `${playerLabel(event.to)} captures a base from ${playerLabel(event.from)}.`;

    case "eliminated": {
      const base = `${playerLabel(event.player)} is eliminated — ${CAUSE_PHRASE[event.cause]}.`;
      const paysBounty = event.bountyTo !== null && !NO_BOUNTY_CAUSES.has(event.cause);
      if (!paysBounty) return base;
      return `${base} Bounty to ${playerLabel(event.bountyTo!)}.`;
    }

    case "victory": {
      const winners = event.players.map(playerLabel).join(" and ");
      const verb = event.players.length > 1 ? "share victory" : "wins";
      return `${winners} ${verb}.`;
    }

    default:
      return assertNever(event);
  }
}

/** Compile-time exhaustiveness guard: an unhandled `GameEvent` kind is a type error here. */
function assertNever(event: never): never {
  throw new Error(`eventLine: unhandled GameEvent ${JSON.stringify(event)}`);
}
