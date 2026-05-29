// ABOUTME: lookahead3 (3-ply minimax) vs heuristic on (c) 2P. Does deeper search find more than 2-ply?
// ABOUTME: 16 games — lookahead3 is expensive (~10x lookahead2 per move).

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
  label: "lookahead3-vs-heuristic-c-2p",
  baseSeed: 28_000n,
  nPlayers: 2,
  gamesPerMatchup: 16,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "lookahead3", spec: { kind: "lookaheadN", depth: 3 } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ] as NamedAgentSpec[],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead3-vs-heuristic-c-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead3-vs-heuristic-c-2p.md"),
}).catch((e: unknown) => {
  console.error(`lookahead3 sweep aborted: ${e instanceof Error ? e.message : String(e)}`);
});
