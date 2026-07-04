// ABOUTME: Designer-time warning predicate for DER #18 — flags a RuleConfig + board combination
// ABOUTME: where a single first-base placement can already reach the iron-victory threshold.
import { generateBoard, loadBoard, legalFirstBaseHexes, distance, seed } from "../engine-client/barrel";
import type { RuleConfig, BoardSource, Board, GameState } from "../engine-client/barrel";

/**
 * At the setup→play boundary each player is a singleton coalition with exactly one base, so
 * their controlled iron is precisely the iron within `config.radius` of that one hex (the
 * engine's `control()` radiating-disk math for one base, with no DER #17 perimeter subtraction
 * possible below 4 bases). This mirrors that math directly off the board (no GameState needed):
 * for each legal first-base hex, count board.iron within `config.radius`, and take the max.
 */
function maxSingleBaseIronCoverage(board: Board, radius: number): number {
  // legalFirstBaseHexes only reads state.board and state.bases; an empty-bases stub is enough
  // to enumerate the outer-ring setup placements without constructing a full GameState.
  const noBasesYet: Pick<GameState, "board" | "bases"> = { board, bases: [] };
  const legalHexes = legalFirstBaseHexes(noBasesYet as GameState);

  let max = 0;
  for (const hex of legalHexes) {
    let count = 0;
    for (const ironHex of board.iron) {
      if (distance(hex, ironHex) <= radius) count++;
    }
    if (count > max) max = count;
  }
  return max;
}

function resolveBoard(boardSource: BoardSource, seedValue: number): Board {
  if (boardSource.kind === "generate") {
    const { board } = generateBoard(seed(BigInt(seedValue)), {
      size: boardSource.size,
      ironCount: boardSource.ironCount,
    });
    return board;
  }
  return loadBoard(boardSource.def);
}

/**
 * True iff some legal first-base placement would already control at least
 * `config.victoryThreshold` iron hexes — i.e. the setup phase itself is instant-winnable under
 * this config (DER #18). Uses `>=` deliberately: the max coverage often lands exactly on the
 * threshold rather than exceeding it, so a strict `>` would miss real degenerate configs.
 */
export function isSetupInstantWinnable(
  config: RuleConfig,
  boardSource: BoardSource,
  seedValue: number,
): boolean {
  const board = resolveBoard(boardSource, seedValue);
  const maxCoverage = maxSingleBaseIronCoverage(board, config.radius);
  return maxCoverage >= config.victoryThreshold;
}
