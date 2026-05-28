// ABOUTME: Track B1 — MCTS@500 vs heuristic, variant (c) 2P. Tests if higher MCTS budget recovers vs the heuristic baseline.
// ABOUTME: Overnight queue step. 48 games — small because @500 is ~3x cost per move vs @100.

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
  label: "mcts500-vs-heuristic-c-2p",
  baseSeed: 16_000n,
  nPlayers: 2,
  gamesPerMatchup: 48,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "mcts500", spec: { kind: "mcts", iterations: 500 } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts500-vs-heuristic-c-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-mcts500-vs-heuristic-c-2p.md"),
}).catch((e: unknown) => {
  console.error(`B1 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
