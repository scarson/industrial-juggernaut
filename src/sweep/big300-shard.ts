// ABOUTME: big300 MCTS measurement — ONE process shard. Runs runGameEntry for its disjoint gameIndex slice
// ABOUTME: (i % numShards === shard) and appends one JSONL line per FINISHED game, so a killed shard still yields partial work.

// Node builtins (the engine/agent layers are Node-free; ambient types in node-shims.d.ts).
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

import { defaultConfig } from "../engine/config";
import type { RuleConfig } from "../engine/config";
import { mctsAgent, defaultMctsParams } from "../agent/mcts-agent";
import { runGameEntry } from "./run";
import type { RunConfigOpts } from "./run";
import { toShardLine } from "./big300-merge";

/** Read a `--flag value` pair from argv; throws if missing. */
function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) throw new Error(`missing --${name}`);
  return process.argv[i + 1]!;
}

const shard = Number(arg("shard"));
const numShards = Number(arg("num-shards"));
const games = Number(arg("games"));
const iters = Number(arg("iters"));
const turnCap = Number(arg("turn-cap"));
const baseSeed = BigInt(arg("base-seed"));
const playerCounts = arg("player-counts").split(",").map((s) => Number(s));
const outPath = arg("out");

// The big300 config — the best near-miss from the weak-agent sweep.
const config: RuleConfig = {
  ...defaultConfig(),
  boardSize: 300,
  radius: 5,
  ironCount: 16,
  victoryThreshold: 12,
};

// Every seat plays a FRESH MCTS agent at `iters` iterations (fair all-MCTS, not
// MCTS-vs-weak). The agent is pure/deterministic given the incoming state.rngState.
const opts: RunConfigOpts = {
  games,
  turnCap,
  baseSeed,
  playerCounts,
  agentFactory: () => mctsAgent({ ...defaultMctsParams(), iterations: iters }),
};

mkdirSync(dirname(outPath), { recursive: true });

// Run this shard's disjoint, interleaved slice of gameIndices and append each
// finished game as a JSONL line. `ironOverTime` is dropped from the serialized
// result (computeMetrics never reads it; keeps capped-game lines small) — the
// parent reconstructs entries with ironOverTime:[] and the metrics are identical.
for (let i = shard; i < games; i += numShards) {
  const t0 = Date.now();
  const entry = runGameEntry(config, opts, i);
  const elapsedMs = Date.now() - t0;
  appendFileSync(outPath, JSON.stringify(toShardLine(i, entry, elapsedMs)) + "\n", "utf8");
  // eslint-disable-next-line no-console
  console.error(
    `[shard ${shard}/${numShards}] game ${i} (n=${entry.nPlayers}): ${entry.result.victoryType} turns=${entry.result.turns} cap=${entry.result.hitTurnCap} ${(elapsedMs / 1000).toFixed(0)}s`,
  );
}
