// ABOUTME: Throwaway probe — run ONE big300 game, all-seats MCTS @ given iters, print result + wall-clock as a JSON line.
// ABOUTME: Args: <nPlayers> <gameIndex> [iters] [turnCap]. CRN seed = gameSeed(1n, gameIndex). For Step 1 feasibility only.

import process from "node:process";
import { runGame } from "../driver/run";
import { defaultConfig } from "../engine/config";
import { mctsAgent, defaultMctsParams } from "../agent/mcts-agent";

const baseSeed = 1n;
const nPlayers = Number(process.argv[2]);
const gameIndex = Number(process.argv[3]);
const iters = Number(process.argv[4] ?? 300);
const turnCap = Number(process.argv[5] ?? 60);

const seed = baseSeed + BigInt(gameIndex);
const config = { ...defaultConfig(), boardSize: 300, radius: 5, ironCount: 16, victoryThreshold: 12 };
const boardSource = { kind: "generate" as const, size: config.boardSize, ironCount: config.ironCount };

const started = Date.now();
let moveCount = 0;
let lastTurn = -1;
const base = mctsAgent({ ...defaultMctsParams(), iterations: iters });
// Progress-instrumented wrapper: logs each turn boundary + per-move wall-clock to
// stderr so a long-running probe shows live progress (turns advanced, ms/move).
const instrumented = (state: import("../engine/types").GameState, player: import("../engine/types").PlayerId) => {
  const t0 = Date.now();
  const out = base(state, player);
  moveCount++;
  const turn = state.phase.turn;
  if (turn !== lastTurn) {
    lastTurn = turn;
    // eslint-disable-next-line no-console
    console.error(`[p${nPlayers} g${gameIndex}] turn=${turn} move#${moveCount} (+${Date.now() - t0}ms/move, total ${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  return out;
};
const result = runGame({
  seed,
  boardSource,
  nPlayers,
  archetypes: Array.from({ length: nPlayers }, () => "economic" as const),
  config,
  turnCap,
  agentFor: () => instrumented,
});
const elapsedMs = Date.now() - started;

// eslint-disable-next-line no-console
console.log(JSON.stringify({
  nPlayers, gameIndex, seed: seed.toString(), iters, turnCap,
  turns: result.turns, victoryType: result.victoryType,
  winnerOrCoalition: result.winnerOrCoalition, hitTurnCap: result.hitTurnCap,
  elapsedMs, elapsedSec: (elapsedMs / 1000).toFixed(1),
}));
