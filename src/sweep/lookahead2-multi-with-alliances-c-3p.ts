// ABOUTME: lookahead2-multi vs heuristic on (c) 3P with alliances ENABLED.
// ABOUTME: Tests whether proper N-player minimax exploits alliance dynamics the heuristic misses.

import { resolve } from "node:path";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { runH2H } from "./lookahead2-h2h-runner";
import type { NamedAgentSpec } from "./run-parallel";

const CONFIG_C_ALLIANCE: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
  alliancesEnabled: true,
  allianceVictoryDelta: 4,
};

void runH2H({
  label: "lookahead2-multi-with-alliances-c-3p",
  baseSeed: 34_000n,
  nPlayers: 3,
  gamesPerMatchup: 100,
  turnCap: 30,
  config: CONFIG_C_ALLIANCE,
  agents: [
    { name: "lookahead2-multi", spec: { kind: "lookahead2-multi" } },
    { name: "heuristic-A", spec: { kind: "heuristic" } },
    { name: "heuristic-B", spec: { kind: "heuristic" } },
  ] as NamedAgentSpec[],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-multi-with-alliances-c-3p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-multi-with-alliances-c-3p.md"),
}).catch((e: unknown) => {
  console.error(`alliances sweep aborted: ${e instanceof Error ? e.message : String(e)}`);
});
