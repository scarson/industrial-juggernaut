// ABOUTME: applyEntry — the per-kind session-log state machine (install rngBeforeApply, compose per declaration, advance).
// ABOUTME: The single composition both recordGame and replayLog route through, so live and replay cannot drift (spec §3).

import { applyAction } from "../engine/apply";
import { applyEliminations, status } from "../engine/status";
import { removeEncircledStrandedBases } from "../engine/stranded";
import { advanceRound, placeFirstBase } from "../engine/turn";
import type { Action, GameEvent, GameState, PlayerId } from "../engine/types";
import type { LogEntry } from "./types";

export type ApplyEntryResult = {
  state: GameState;
  events: GameEvent[];
  advanced: boolean; // did this entry close a round (call advanceRound)?
  terminal: ReturnType<typeof status> | null; // set when the round-closing status() found a victory
};

/** The per-declaration canonical composition: applyAction -> applyEliminations(actor) -> removeStranded. */
function compose(state: GameState, player: PlayerId, action: Action): { state: GameState; events: GameEvent[] } {
  const applied = applyAction(state, action);
  const elim = applyEliminations(applied.state, player);
  const stranded = removeEncircledStrandedBases(elim.state);
  return { state: stranded.state, events: [...applied.events, ...elim.events, ...stranded.events] };
}

/** Install rngBeforeApply, run the kind's engine steps, and report whether the round closed + any terminal status. */
export function applyEntry(state: GameState, entry: LogEntry): ApplyEntryResult {
  const installed: GameState = { ...state, rngState: entry.rngBeforeApply };

  if (entry.kind === "placeFirstBase") {
    const next = placeFirstBase(installed, entry.player, entry.hex);
    return { state: next, events: [], advanced: false, terminal: null };
  }

  // For build/attack/pass, run the canonical composition.
  let composed = installed;
  let events: GameEvent[] = [];
  if (entry.kind === "build") {
    const r = compose(installed, entry.player, { kind: "build", pieces: entry.pieces });
    composed = r.state; events = r.events;
  } else if (entry.kind === "attack") {
    const r = compose(installed, entry.player, { kind: "attack", attacks: [entry.decl] });
    composed = r.state; events = r.events;
  } else if (entry.kind === "pass") {
    const r = compose(installed, entry.player, { kind: "pass" });
    composed = r.state; events = r.events;
  }
  // endRound / roundSkipped: no composition (battles already applied / eliminated slot).

  // attack does not close the round — the chain continues.
  if (entry.kind === "attack") {
    return { state: composed, events, advanced: false, terminal: null };
  }

  // Round-closing kinds: status() once, before advanceRound (rules: victory "at end of round").
  const st = status(composed);
  if (st.kind === "victory") {
    return { state: composed, events, advanced: true, terminal: st };
  }
  return { state: advanceRound(composed), events, advanced: true, terminal: null };
}
