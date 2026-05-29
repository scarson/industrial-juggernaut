// ABOUTME: Track C1 — proper N-player minimax vs heuristic on variant (c) 3P, 150 games.
// ABOUTME: Sam's "is 3P heuristic really optimal" question. If lookahead2-multi STILL plays at baseline, heuristic IS near-optimal in 3P.

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
  label: "lookahead2-multi-vs-heuristic-c-3p",
  baseSeed: 20_000n,
  nPlayers: 3,
  gamesPerMatchup: 150,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "lookahead2-multi", spec: { kind: "lookahead2-multi" } },
    { name: "heuristic-A", spec: { kind: "heuristic" } },
    { name: "heuristic-B", spec: { kind: "heuristic" } },
  ] as NamedAgentSpec[],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-multi-vs-heuristic-c-3p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-multi-vs-heuristic-c-3p.md"),
}).catch((e: unknown) => {
  console.error(`C1 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
