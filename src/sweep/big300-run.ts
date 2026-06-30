// ABOUTME: big300 MCTS measurement — PARENT orchestrator. Spawns N disjoint gameIndex shards across cores,
// ABOUTME: merges their JSONL entries by gameIndex, runs computeMetrics + isHealthy, writes metrics JSON + a markdown verdict.

// Node builtins (the engine/agent layers are Node-free; ambient types in node-shims.d.ts).
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import process from "node:process";

import { computeMetrics, type SweepMetrics } from "./metrics";
import { isHealthy, defaultHealthThresholds } from "./health";
import { proportionCI } from "./run";
import { toEntries, type ShardLine } from "./big300-merge";

/** Read a `--flag value` pair from argv, or a default if absent. */
function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return dflt;
  return process.argv[i + 1]!;
}

// --- Run parameters (CRN-comparable to the weak sweep: baseSeed=1, playerCounts [2,3,4,5,6]) ---
const GAMES = Number(arg("games", "50"));
const ITERS = Number(arg("iters", "300"));
const TURN_CAP = Number(arg("turn-cap", "60"));
const BASE_SEED = arg("base-seed", "1");
const PLAYER_COUNTS = arg("player-counts", "2,3,4,5,6");
const NUM_SHARDS = Number(arg("num-shards", "8"));
const LABEL = arg("label", "big300-mcts");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const outDir = resolve(repoRoot, "docs", "sweeps", "mcts-big300");
const shardDir = resolve(outDir, `${LABEL}-shards`);

/** Spawn all shards and resolve when every one exits. */
function runShards(): Promise<void> {
  // Fresh shard dir so a re-run does not merge stale lines.
  if (existsSync(shardDir)) rmSync(shardDir, { recursive: true, force: true });
  mkdirSync(shardDir, { recursive: true });

  const shardScript = resolve(here, "big300-shard.ts");
  const procs: Promise<void>[] = [];
  for (let shard = 0; shard < NUM_SHARDS; shard++) {
    const outPath = resolve(shardDir, `shard-${shard}.jsonl`);
    procs.push(
      new Promise<void>((res, rej) => {
        const child = spawn(
          "bunx",
          [
            "tsx",
            shardScript,
            "--shard", String(shard),
            "--num-shards", String(NUM_SHARDS),
            "--games", String(GAMES),
            "--iters", String(ITERS),
            "--turn-cap", String(TURN_CAP),
            "--base-seed", BASE_SEED,
            "--player-counts", PLAYER_COUNTS,
            "--out", outPath,
          ],
          { stdio: "inherit", cwd: repoRoot },
        );
        child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`shard ${shard} exited ${code}`))));
        child.on("error", rej);
      }),
    );
  }
  return Promise.all(procs).then(() => undefined);
}

/** Read every shard JSONL file, parse lines, and return them. Tolerates a trailing partial line. */
function collectLines(): ShardLine[] {
  const lines: ShardLine[] = [];
  for (let shard = 0; shard < NUM_SHARDS; shard++) {
    const p = resolve(shardDir, `shard-${shard}.jsonl`);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split("\n")) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      try {
        lines.push(JSON.parse(trimmed) as ShardLine);
      } catch {
        // Ignore a partial final line (a shard killed mid-write).
      }
    }
  }
  return lines;
}

function frac(n: number): string {
  return n.toFixed(4);
}
function fracCI(p: number, n: number): string {
  return `${frac(p)} ± ${frac(proportionCI(p, n))}`;
}

/** Per-player-count breakdown of cap-hits / iron-victories / counts. */
function byPlayerCount(lines: ShardLine[]): Record<number, { games: number; capHit: number; iron: number; lastStanding: number; none: number }> {
  const out: Record<number, { games: number; capHit: number; iron: number; lastStanding: number; none: number }> = {};
  for (const l of lines) {
    const r = (out[l.nPlayers] ??= { games: 0, capHit: 0, iron: 0, lastStanding: 0, none: 0 });
    r.games++;
    if (l.result.hitTurnCap) r.capHit++;
    if (l.result.victoryType === "iron") r.iron++;
    if (l.result.victoryType === "last-standing") r.lastStanding++;
    if (l.result.victoryType === "none") r.none++;
  }
  return out;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  // `--merge-only` skips spawning and just aggregates whatever JSONL the shards
  // have already written. Used to summarize a partial run after an EARLY STOP
  // (the hazard: a 6P game grinding toward the cap need not be waited out — its
  // unfinished game is simply absent, and the completed games still give the
  // directional capHit answer), or to re-summarize without re-running.
  const mergeOnly = process.argv.includes("--merge-only");
  console.error(
    `[big300-run] ${LABEL}: ${GAMES} games, ${ITERS} iters, turnCap=${TURN_CAP}, baseSeed=${BASE_SEED}, playerCounts=[${PLAYER_COUNTS}], ${NUM_SHARDS} shards${mergeOnly ? " (MERGE-ONLY)" : ""}`,
  );

  if (!mergeOnly) await runShards();

  const lines = collectLines();
  const entries = toEntries(lines);
  const metrics: SweepMetrics = computeMetrics(entries);
  const health = isHealthy(metrics, defaultHealthThresholds());
  const n = metrics.gamesPlayed;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  const perCount = byPlayerCount(lines);
  const slowest = [...lines].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 5);

  // --- JSON artifact (the raw numbers Sam reviews) ---
  const jsonOut = {
    label: LABEL,
    params: { games: GAMES, iters: ITERS, turnCap: TURN_CAP, baseSeed: BASE_SEED, playerCounts: PLAYER_COUNTS, numShards: NUM_SHARDS },
    gamesCompleted: n,
    elapsedSec: Number(elapsedSec),
    metrics,
    health,
    perPlayerCount: perCount,
    perGame: [...lines].sort((a, b) => a.gameIndex - b.gameIndex),
  };
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, `${LABEL}-metrics.json`);
  writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2), "utf8");

  // --- Console summary ---
  console.error(`\n===== big300 under all-MCTS (${ITERS} iters) =====`);
  console.error(`games completed: ${n} / ${GAMES}   wall-clock: ${elapsedSec}s   shards: ${NUM_SHARDS}`);
  console.error(`medianTurns:           ${metrics.medianTurns}  (mean ${metrics.meanTurns.toFixed(2)})`);
  console.error(`capHitFraction:        ${fracCI(metrics.capHitFraction, n)}   [gate: <= ${defaultHealthThresholds().maxCapHit}]`);
  console.error(`ironVictoryFraction:   ${fracCI(metrics.ironVictoryFraction, n)}   [gate: >= ${defaultHealthThresholds().minIronVictory}]`);
  console.error(`setupDecidedFraction:  ${fracCI(metrics.setupDecidedFraction, n)}   [gate: <= ${defaultHealthThresholds().maxSetupDecided}]`);
  console.error(`leadVolatility:        ${fracCI(metrics.leadVolatility, n)}   [gate: >= ${defaultHealthThresholds().minLeadVolatility}]`);
  console.error(`seatWinBias (max):     ${frac(metrics.seatWinBias.maxBiasAcrossGroups)}   [gate: <= ${defaultHealthThresholds().maxSeatBias}]`);
  console.error(`victoryType counts:    ${JSON.stringify(metrics.victoryType)}`);
  console.error(`HEALTHY: ${health.pass ? "YES" : "NO"}${health.pass ? "" : "  failing: " + health.reasons.join("; ")}`);
  console.error(`per-player-count:      ${JSON.stringify(perCount)}`);
  console.error(`slowest games (ms):    ${slowest.map((s) => `n${s.nPlayers}/g${s.gameIndex}=${(s.elapsedMs / 1000).toFixed(0)}s(t${s.result.turns},${s.result.victoryType})`).join("  ")}`);
  console.error(`\nmetrics JSON: ${jsonPath}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("big300-run failed:", e);
  process.exit(1);
});
