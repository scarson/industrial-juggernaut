// ABOUTME: initGame — the single shared game-init (board source + setup-phase state) for client and harness.
// ABOUTME: Threads rng per GEO-3 (board-gen advances rng before setup). Pure; no Node APIs, no agent/driver imports.

import { generateBoard } from "../board/generate";
import { loadBoard } from "../board/load";
import { seed } from "../rng/pcg";
import { setupPhaseState } from "./turn";
import type { RuleConfig } from "./config";
import type { Board, BoardSource, GameState } from "./types";

/**
 * Build the setup-phase state for a new game. Handles both board sources
 * (generate threads rng forward per GEO-3; fixed loads a definition), then returns
 * the turn-0 setup state. The caller auto-places (agents) or drives placement
 * (humans), then runs status() to detect a born-terminal game.
 */
export function initGame(opts: {
  seed: bigint;
  boardSource: BoardSource;
  nPlayers: number;
  config: RuleConfig;
}): GameState {
  let rng = seed(opts.seed);
  let board: Board;
  if (opts.boardSource.kind === "generate") {
    const g = generateBoard(rng, { size: opts.boardSource.size, ironCount: opts.boardSource.ironCount });
    board = g.board;
    rng = g.rng;
  } else {
    board = loadBoard(opts.boardSource.def);
  }
  return setupPhaseState(rng, board, opts.nPlayers, opts.config);
}
