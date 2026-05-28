// ABOUTME: Track A3 — lookahead2 vs heuristic, variant (c) 4P, 100 games. Tests whether the exploit generalizes to 4P.
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
  label: "lookahead2-vs-heuristic-c-4p",
  baseSeed: 14_000n,
  nPlayers: 4,
  gamesPerMatchup: 100,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "lookahead2", spec: { kind: "lookahead2" } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-vs-heuristic-c-4p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-vs-heuristic-c-4p.md"),
}).catch((e: unknown) => {
  console.error(`A3 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
