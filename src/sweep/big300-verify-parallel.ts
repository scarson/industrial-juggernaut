// ABOUTME: Empirical parallel==sequential guard for the process-sharded runner — spawns REAL cheap shard subprocesses
// ABOUTME: (heuristic agent, small board), merges their JSONL via the shared seam, and asserts metrics == sequential runConfig.

// Node builtins (engine/agent layers are Node-free; ambient types in node-shims.d.ts).
import { mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import process from "node:process";

import { defaultConfig } from "../engine/config";
import type { RuleConfig } from "../engine/config";
import { runConfig } from "./run";
import type { RunConfigOpts } from "./run";
import { computeMetrics } from "./metrics";
import { toEntries, type ShardLine } from "./big300-merge";

// A CHEAP config + the default (heuristic) agent — small board, fast games — so
// this guard runs the FULL subprocess serialization path quickly. The point is
// to confirm the plumbing (spawn → JSONL append → parse → reconstruct → merge →
// computeMetrics) reproduces sequential metrics byte-for-byte; the agent and
// board are irrelevant to that invariant, so we pick the fastest ones.
const CHEAP_CONFIG: RuleConfig = { ...defaultConfig(), boardSize: 61, ironCount: 8, radius: 4 };
const GAMES = 24;
const TURN_CAP = 60;
const BASE_SEED = 1n;
const PLAYER_COUNTS = [2, 3, 4, 5, 6];
const NUM_SHARDS = 4;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const shardDir = resolve(repoRoot, "docs", "sweeps", "mcts-big300", "verify-shards");

const opts: RunConfigOpts = {
  games: GAMES,
  turnCap: TURN_CAP,
  baseSeed: BASE_SEED,
  playerCounts: PLAYER_COUNTS,
  // agentFactory omitted → default heuristicAgent (fast).
};

function runShards(): Promise<void> {
  if (existsSync(shardDir)) rmSync(shardDir, { recursive: true, force: true });
  mkdirSync(shardDir, { recursive: true });
  const shardScript = resolve(here, "big300-verify-shard.ts");
  const procs: Promise<void>[] = [];
  for (let shard = 0; shard < NUM_SHARDS; shard++) {
    const outPath = resolve(shardDir, `shard-${shard}.jsonl`);
    procs.push(
      new Promise<void>((res, rej) => {
        const child = spawn(
          "bunx",
          [
            "tsx", shardScript,
            "--shard", String(shard),
            "--num-shards", String(NUM_SHARDS),
            "--games", String(GAMES),
            "--turn-cap", String(TURN_CAP),
            "--base-seed", BASE_SEED.toString(),
            "--player-counts", PLAYER_COUNTS.join(","),
            "--out", outPath,
          ],
          { stdio: "ignore", cwd: repoRoot },
        );
        child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`shard ${shard} exited ${code}`))));
        child.on("error", rej);
      }),
    );
  }
  return Promise.all(procs).then(() => undefined);
}

function collectLines(): ShardLine[] {
  const lines: ShardLine[] = [];
  for (let shard = 0; shard < NUM_SHARDS; shard++) {
    const p = resolve(shardDir, `shard-${shard}.jsonl`);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split("\n")) {
      const t = raw.trim();
      if (t.length === 0) continue;
      lines.push(JSON.parse(t) as ShardLine);
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const sequential = runConfig(CHEAP_CONFIG, opts);
  await runShards();
  const lines = collectLines();
  const parallel = computeMetrics(toEntries(lines));

  const seqJson = JSON.stringify(sequential);
  const parJson = JSON.stringify(parallel);
  const identical = seqJson === parJson;

  // eslint-disable-next-line no-console
  console.log(
    `[verify-parallel] games=${GAMES} shards=${NUM_SHARDS} collected=${lines.length}\n` +
      `  sequential.gamesPlayed=${sequential.gamesPlayed} parallel.gamesPlayed=${parallel.gamesPlayed}\n` +
      `  capHit  seq=${sequential.capHitFraction} par=${parallel.capHitFraction}\n` +
      `  iron    seq=${sequential.ironVictoryFraction} par=${parallel.ironVictoryFraction}\n` +
      `  median  seq=${sequential.medianTurns} par=${parallel.medianTurns}\n` +
      `  IDENTICAL: ${identical ? "YES" : "NO"}`,
  );
  rmSync(shardDir, { recursive: true, force: true });
  if (!identical) {
    // eslint-disable-next-line no-console
    console.error("MISMATCH:\n seq=" + seqJson + "\n par=" + parJson);
    process.exit(1);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("verify-parallel failed:", e);
  process.exit(1);
});
