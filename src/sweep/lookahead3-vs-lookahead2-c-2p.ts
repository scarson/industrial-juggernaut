// ABOUTME: Does 3-ply beat 2-ply directly? lookahead3 vs lookahead2 on (c) 2P.
// ABOUTME: A strong-vs-strong test: if lookahead3 wins meaningfully, depth keeps finding more.

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
  label: "lookahead3-vs-lookahead2-c-2p",
  baseSeed: 33_000n,
  nPlayers: 2,
  gamesPerMatchup: 16,
  turnCap: 30,
  config: CONFIG_C,
  agents: [
    { name: "lookahead3", spec: { kind: "lookaheadN", depth: 3 } },
    { name: "lookahead2", spec: { kind: "lookahead2" } },
  ] as NamedAgentSpec[],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead3-vs-lookahead2-c-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead3-vs-lookahead2-c-2p.md"),
}).catch((e: unknown) => {
  console.error(`lookahead3-vs-lookahead2 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
