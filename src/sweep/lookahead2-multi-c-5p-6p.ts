// ABOUTME: 5P + 6P player-count check. Does the mechanical-3P+ pattern hold at higher player counts?

import { resolve } from "node:path";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { runH2H } from "./lookahead2-h2h-runner";
import type { NamedAgentSpec } from "./run-parallel";

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

function mkAgents(n: number): NamedAgentSpec[] {
  const a: NamedAgentSpec[] = [{ name: "lookahead2-multi", spec: { kind: "lookahead2-multi" } }];
  for (let i = 1; i < n; i++) {
    a.push({ name: `heuristic-${String.fromCharCode(64 + i)}`, spec: { kind: "heuristic" } });
  }
  return a;
}

async function run5P() {
  await runH2H({
    label: "lookahead2-multi-vs-heuristic-c-5p",
    baseSeed: 29_000n,
    nPlayers: 5,
    gamesPerMatchup: 60,
    turnCap: 30,
    config: CONFIG_C,
    agents: mkAgents(5),
    jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-multi-vs-heuristic-c-5p.jsonl"),
    markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-multi-vs-heuristic-c-5p.md"),
  });
}

async function run6P() {
  await runH2H({
    label: "lookahead2-multi-vs-heuristic-c-6p",
    baseSeed: 30_000n,
    nPlayers: 6,
    gamesPerMatchup: 60,
    turnCap: 30,
    config: CONFIG_C,
    agents: mkAgents(6),
    jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-multi-vs-heuristic-c-6p.jsonl"),
    markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-multi-vs-heuristic-c-6p.md"),
  });
}

(async () => {
  await run5P();
  await run6P();
})().catch((e: unknown) => {
  console.error(`5P/6P aborted: ${e instanceof Error ? e.message : String(e)}`);
});
