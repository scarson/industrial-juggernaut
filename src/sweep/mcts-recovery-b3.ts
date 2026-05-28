// ABOUTME: Track B3 — lookahead2 vs MCTS@500, variant (c) 2P, 32 games. Does the 2-step exploit also beat higher-budget MCTS?
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
  label: "lookahead2-vs-mcts500-c-2p",
  baseSeed: 18_000n,
  nPlayers: 2,
  gamesPerMatchup: 32,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "lookahead2", spec: { kind: "lookahead2" } },
    { name: "mcts500", spec: { kind: "mcts", iterations: 500 } },
  ],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-vs-mcts500-c-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-vs-mcts500-c-2p.md"),
}).catch((e: unknown) => {
  console.error(`B3 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
