// ABOUTME: Track B2 — MCTS@1000 vs heuristic, variant (c) 2P, 32 games.
// ABOUTME: Overnight queue step.

import { resolve } from "node:path";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { runH2H } from "./lookahead2-h2h-runner";

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96,
  radius: 2,
  ironCount: 14,
  victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

void runH2H({
  label: "mcts1000-vs-heuristic-c-2p",
  baseSeed: 17_000n,
  nPlayers: 2,
  gamesPerMatchup: 32,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "mcts1000", spec: { kind: "mcts", iterations: 1000 } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts1000-vs-heuristic-c-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-mcts1000-vs-heuristic-c-2p.md"),
}).catch((e: unknown) => {
  console.error(`B2 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
