// ABOUTME: Track A4 — lookahead2 vs heuristic, DEFAULT variant 2P, 200 games. Tests whether the exploit is (c)-specific.
// ABOUTME: Overnight queue step. Default config: noIronRequiresPerimeter=false, radius=5, larger placeRange.

import { resolve } from "node:path";
import { defaultConfig } from "../engine/config";
import { runH2H } from "./lookahead2-h2h-runner";

// Use defaultConfig() unchanged — that's literally the "default variant" baseline.
const CONFIG = defaultConfig();

void runH2H({
  label: "lookahead2-vs-heuristic-default-2p",
  baseSeed: 15_000n,
  nPlayers: 2,
  gamesPerMatchup: 200,
  turnCap: 30,
  config: CONFIG,
  agents: [
    { name: "lookahead2", spec: { kind: "lookahead2" } },
    { name: "heuristic", spec: { kind: "heuristic" } },
  ],
  jsonlPath: resolve(process.cwd(), "docs/sweeps/data/2026-05-29-lookahead2-vs-heuristic-default-2p.jsonl"),
  markdownPath: resolve(process.cwd(), "docs/2026-05-29-lookahead2-vs-heuristic-default-2p.md"),
}).catch((e: unknown) => {
  console.error(`A4 aborted: ${e instanceof Error ? e.message : String(e)}`);
});
