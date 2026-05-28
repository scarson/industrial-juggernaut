// ABOUTME: Track E — longer-game regime grid. Sweep (boardSize x victoryThreshold) on variant (c)'s noIronRequiresPerimeter to find configs where games last 5+ turns.
// ABOUTME: For each config, run lookahead2 vs heuristic to test whether the 2-step exploit still dominates in longer-game regimes.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { SweepMetrics } from "./metrics";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-longer-game-regime-grid.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-longer-game-regime-grid.md");

const BASE_SEED = 19_000n;
const TURN_CAP = 60;
const GAMES_PER_CELL = 30;
const PLAYER_COUNTS = [2];
const WORKERS = workerCount();

/**
 * Grid axes:
 *   boardSize ∈ {96, 144, 192} — larger boards spread opening positions farther apart.
 *   victoryThreshold ∈ {10, 14, 18} — higher threshold = more iron needed = longer games.
 *   ironCount ∈ {14, 20} — more iron on board reduces contention pressure.
 *
 * Total: 3 × 3 × 2 = 18 cells × 30 games = 540 games. Heuristic self-play (~3-5s/game) ≈ 30-45 min.
 */
const BOARD_SIZES = [96, 144, 192];
const VICTORY_THRESHOLDS = [10, 14, 18];
const IRON_COUNTS = [14, 20];

interface CellResult {
  boardSize: number;
  victoryThreshold: number;
  ironCount: number;
  metrics: SweepMetrics | null;
  elapsedSec: number;
}

async function runCell(boardSize: number, victoryThreshold: number, ironCount: number, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const config: RuleConfig = {
    ...defaultConfig(),
    boardSize,
    radius: 2,
    ironCount,
    victoryThreshold,
    noIronRequiresPerimeter: true,
  };
  const label = `bs=${boardSize}/vt=${victoryThreshold}/iron=${ironCount}`;
  console.log(`\n-- ${label}, ${GAMES_PER_CELL} 2P games, heuristic self-play --`);

  let metrics: SweepMetrics | null = null;
  try {
    metrics = await runConfigParallel(
      config,
      {
        games: GAMES_PER_CELL,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: [...PLAYER_COUNTS],
        agentSpec: { kind: "heuristic" },
        onGame: (done, total, n, r) => {
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} ${n}P t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 10 === 0 || done === total) {
            console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              boardSize, victoryThreshold, ironCount,
              done, total, nPlayers: n,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "longer-game-grid", done, total, summary },
          });
        },
      },
      pool,
    );
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { boardSize, victoryThreshold, ironCount, metrics, elapsedSec: (Date.now() - tStart) / 1000 };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Longer-game regime grid (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Axes: boardSize ${BOARD_SIZES.join(",")} × victoryThreshold ${VICTORY_THRESHOLDS.join(",")} × ironCount ${IRON_COUNTS.join(",")}`);
  console.log(`Games per cell: ${GAMES_PER_CELL}, turnCap ${TURN_CAP}, 2P heuristic self-play.`);

  const results: CellResult[] = [];
  try {
    for (const bs of BOARD_SIZES) {
      for (const vt of VICTORY_THRESHOLDS) {
        for (const ic of IRON_COUNTS) {
          const r = await runCell(bs, vt, ic, pool, t0);
          results.push(r);
        }
      }
    }
  } finally {
    pool.close();
  }

  // Report.
  const lines: string[] = [];
  lines.push(`# Longer-Game Regime Grid (Track E)`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29 overnight queue. **Trigger:** Opus playtest showed lookahead2 beats heuristic ~80% on variant (c) 2P partly because games end in 2 turns. This grid finds configs where median turns is 5+ — candidates for "longer-game regimes" where mid-game strategy might dominate over opening enumeration.`);
  lines.push(``);
  lines.push(`**Methodology:** heuristic self-play (2P), variant (c) base with noIronRequiresPerimeter=true. Sweeping boardSize × victoryThreshold × ironCount. ${GAMES_PER_CELL} games per cell, baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| boardSize | victoryThreshold | ironCount | Median turns | Iron-vic% | Last-stand% | CapHit% | Elapsed |`);
  lines.push(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of results) {
    if (r.metrics === null) {
      lines.push(`| ${r.boardSize} | ${r.victoryThreshold} | ${r.ironCount} | — | — | — | — | FAILED |`);
      continue;
    }
    const m = r.metrics;
    const vt = m.victoryType;
    const lsPct = ((vt["last-standing"] ?? 0) / m.gamesPlayed * 100).toFixed(0);
    const ironPct = (m.ironVictoryFraction * 100).toFixed(0);
    const capPct = (m.capHitFraction * 100).toFixed(0);
    lines.push(`| ${r.boardSize} | ${r.victoryThreshold} | ${r.ironCount} | ${m.medianTurns} | ${ironPct}% | ${lsPct}% | ${capPct}% | ${r.elapsedSec.toFixed(0)}s |`);
  }
  lines.push(``);

  // Auto-flag candidates: cells with medianTurns >= 5 AND capHit <= 20%.
  const candidates = results.filter((r) => r.metrics !== null && r.metrics.medianTurns >= 5 && r.metrics.capHitFraction <= 0.2);
  lines.push(`## Candidate longer-game regimes`);
  lines.push(``);
  if (candidates.length === 0) {
    lines.push(`None of the tested cells produced median ≥ 5 turns with capHit ≤ 20%. The (c)-base regime resists lengthening across this grid — even at boardSize=192 / vt=18 / iron=20.`);
  } else {
    lines.push(`Cells with median turns ≥ 5 AND capHit ≤ 20% (real longer-game regimes, not turn-cap exhaustion):`);
    for (const c of candidates) {
      const m = c.metrics!;
      lines.push(`- **bs=${c.boardSize}, vt=${c.victoryThreshold}, iron=${c.ironCount}:** median turns ${m.medianTurns}, iron-vic ${(m.ironVictoryFraction * 100).toFixed(0)}%, capHit ${(m.capHitFraction * 100).toFixed(0)}%.`);
    }
    lines.push(``);
    lines.push(`These are candidates for follow-up: do lookahead2's gains vs heuristic shrink or vanish at these settings?`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/longer-game-regime-grid.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`longer-game-regime-grid aborted: ${e instanceof Error ? e.message : String(e)}`);
});
