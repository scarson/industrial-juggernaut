// ABOUTME: MCTS@2000 vs heuristic on (c) 2P. Does even higher MCTS budget recover vs heuristic?

import { resolve } from "node:path";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { runH2H } from "./lookahead2-h2h-runner";
import type { NamedAgentSpec } from "./run-parallel";

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

void runH2H({
  label: "mcts2000-vs-heuristic-c-2p",
  baseSeed: 31_000n,
  nPlayers: 2,
  gamesPerMatchup: 16,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "mcts2000", spec: { kind: "mcts", iterations: 2000 } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ] as NamedAgentSpec[],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-mcts2000-vs-heuristic-c-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-mcts2000-vs-heuristic-c-2p.md"),
}).catch((e: unknown) => {
  console.error(`mcts2000 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
