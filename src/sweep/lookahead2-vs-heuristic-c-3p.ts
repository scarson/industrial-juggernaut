// ABOUTME: Track A2 — lookahead2 vs heuristic, variant (c) 3P, 150 games. Tests whether the exploit generalizes to 3P.
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
  label: "lookahead2-vs-heuristic-c-3p",
  baseSeed: 13_000n,
  nPlayers: 3,
  gamesPerMatchup: 150,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "lookahead2", spec: { kind: "lookahead2" } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-vs-heuristic-c-3p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-vs-heuristic-c-3p.md"),
}).catch((e: unknown) => {
  console.error(`A2 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
