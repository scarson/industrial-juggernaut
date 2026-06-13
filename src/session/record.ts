// ABOUTME: recordGame — plays an all-agent game, emitting a faithful LogEntry[] + per-boundary stateHash[].
// ABOUTME: rngBeforeApply for agent actions is the agent closure's post-selection state; spec §3 replay model.

import { initGame } from "../engine/init";
import { status } from "../engine/status";
import { currentPlayer, representativeFirstBase } from "../engine/turn";
import { greedyAgent, type Agent } from "../agent/agent";
import { heuristicAgent } from "../agent/heuristic-agent";
import { applyEntry } from "./round";
import { stateHash } from "./hash";
import type { GameEvent, GameState } from "../engine/types";
import type { LogEntry, SeatConfig, SessionHeader } from "./types";

function agentForSeat(seat: SeatConfig): Agent {
  if (seat.kind === "human") throw new Error("recordGame: human seat unsupported (interactive play is plan 2)");
  if (seat.agent === "greedy") return greedyAgent(seat.archetype);
  if (seat.agent === "heuristic") return heuristicAgent();
  throw new Error(`recordGame: unsupported agent ${(seat as any).agent}`);
}

export type RecordResult = {
  header: SessionHeader;
  log: LogEntry[];
  boundaryHashes: string[];
  events: GameEvent[]; // all engine events across the game, in order (for §7 edge tests + the all-agent viewer narration)
  finalState: GameState;
  hitTurnCap: boolean;
};

export function recordGame(header: SessionHeader, opts: { turnCap: number }): RecordResult {
  const agents = header.seats.map(agentForSeat);
  let state = initGame({ seed: header.seed, boardSource: header.boardSource, nPlayers: header.seats.length, config: header.config });
  const log: LogEntry[] = [];
  const boundaryHashes: string[] = [];
  const events: GameEvent[] = [];
  const finalize = (hitTurnCap: boolean): RecordResult => ({ header, log, boundaryHashes, events, finalState: state, hitTurnCap });
  // Apply one entry: thread state, push the entry + its events, record a boundary hash on close.
  const step = (entry: LogEntry): ReturnType<typeof applyEntry> => {
    const out = applyEntry(state, entry);
    state = out.state; log.push(entry); events.push(...out.events);
    if (out.advanced) boundaryHashes.push(stateHash(state));
    return out;
  };

  // Setup: log a placeFirstBase for every seat in placement order (no boundary — setup never advances a round).
  while (state.phase.turn === 0) {
    const p = state.phase.order[state.phase.indexInOrder]!;
    step({ player: p, kind: "placeFirstBase", hex: representativeFirstBase(state, p), rngBeforeApply: state.rngState });
  }

  if (status(state).kind === "victory") return finalize(false); // born-terminal

  for (;;) {
    const p = currentPlayer(state);
    if (state.players[p]!.eliminated) {
      if (step({ player: p, kind: "roundSkipped", rngBeforeApply: state.rngState }).terminal) return finalize(false);
    } else {
      const choice = agents[p]!(state, p);
      const rng = choice.state.rngState; // post-selection, pre-apply
      const action = choice.action;
      if (action.kind === "build") {
        if (step({ player: p, kind: "build", pieces: action.pieces.map((x) => ({ type: x.type, hex: x.hex })), rngBeforeApply: rng }).terminal) return finalize(false);
      } else if (action.kind === "pass") {
        if (step({ player: p, kind: "pass", rngBeforeApply: rng }).terminal) return finalize(false);
      } else { // attack — single decl + auto endRound
        if (action.attacks.length !== 1) throw new Error("recordGame: v1 agents must emit single-declaration attacks");
        step({ player: p, kind: "attack", decl: action.attacks[0]!, rngBeforeApply: rng }); // does not close the round
        if (step({ player: p, kind: "endRound", rngBeforeApply: state.rngState }).terminal) return finalize(false);
      }
    }
    if (state.phase.turn > opts.turnCap) return finalize(true);
  }
}
