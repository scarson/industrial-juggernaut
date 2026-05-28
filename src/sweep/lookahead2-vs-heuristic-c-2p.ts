// ABOUTME: Track A1 — lookahead2 vs heuristic, variant (c) 2P, 300 games. Confirms the Opus playtest's ~80% claim at scale.
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
  label: "lookahead2-vs-heuristic-c-2p",
  baseSeed: 12_000n,
  nPlayers: 2,
  gamesPerMatchup: 300,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "lookahead2", spec: { kind: "lookahead2" } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-vs-heuristic-c-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-vs-heuristic-c-2p.md"),
}).catch((e: unknown) => {
  console.error(`A1 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
