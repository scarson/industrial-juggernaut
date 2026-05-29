// ABOUTME: lookahead2-multi vs heuristic on (c)+(b) variant 3P — does variant (b)'s extended games restore strategic depth?
// ABOUTME: V showed (c) 3P is mechanical; AB showed (c)+(b) extends to median 3 turns. Does this restore lookahead2-multi advantage?

import { resolve } from "node:path";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { runH2H } from "./lookahead2-h2h-runner";
import type { NamedAgentSpec } from "./run-parallel";

const CONFIG_C_B: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
  victoryIronHoldRounds: 2,
};

void runH2H({
  label: "lookahead2-multi-vs-heuristic-c-b-3p",
  baseSeed: 35_000n,
  nPlayers: 3,
  gamesPerMatchup: 100,
  turnCap: 30,
  config: CONFIG_C_B,
  agents: [
    { name: "lookahead2-multi", spec: { kind: "lookahead2-multi" } },
    { name: "heuristic-A", spec: { kind: "heuristic" } },
    { name: "heuristic-B", spec: { kind: "heuristic" } },
  ] as NamedAgentSpec[],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-multi-vs-heuristic-c-b-3p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-multi-vs-heuristic-c-b-3p.md"),
}).catch((e: unknown) => {
  console.error(`c+b sweep aborted: ${e instanceof Error ? e.message : String(e)}`);
});
