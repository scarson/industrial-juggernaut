// ABOUTME: Track R — random vs heuristic on (c) 2P/3P/4P. Skill floor sanity check.
// ABOUTME: If heuristic CRUSHES random in 3P+ but lookahead2-multi doesn't beat heuristic, the heuristic IS near-optimal.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-random-vs-heuristic.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-random-vs-heuristic.md");

const BASE_SEED = 25_000n;
const TURN_CAP = 30;
const GAMES_PER_CELL = 60;
const WORKERS = workerCount();
const PLAYER_COUNTS = [2, 3, 4] as const;

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

interface CellResult {
  nPlayers: number;
  randomWinRate: number;
  heuristicWinRate: number;
  baseline: number;
  delta: number;        // randomWinRate - baseline (negative means heuristic provides skill)
  elapsedSec: number;
}

async function runCell(nPlayers: number, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const baseline = 1 / nPlayers;
  const label = `random-vs-heuristic/${nPlayers}P`;
  console.log(`\n-- ${label} (${GAMES_PER_CELL} games) --`);

  const agents: NamedAgentSpec[] = [{ name: "random", spec: { kind: "random" } }];
  for (let i = 1; i < nPlayers; i++) {
    agents.push({ name: `heuristic-${String.fromCharCode(64 + i)}`, spec: { kind: "heuristic" } });
  }

  let randomWinRate = 0;
  let heuristicWinRate = 0;
  try {
    const rr = await roundRobinParallel(
      agents,
      {
        playerCounts: [nPlayers],
        gamesPerMatchup: GAMES_PER_CELL,
        seed: BASE_SEED,
        config: CONFIG_C,
        turnCap: TURN_CAP,
        onGame: (done, total, _pc, r) => {
          const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
          const summary = `${label} t=${r.turns} ${r.victoryType} w=${w}`;
          if (done % 20 === 0 || done === total) {
            console.log(`  [${label} ${done}/${total}] ${summary} (${elapsedS(t0)})`);
          }
          appendResultAndCommit(INCREMENTAL_PATH, {
            data: {
              nPlayers, done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "random-vs-heuristic", done, total, summary },
          });
        },
      },
      pool,
    );
    randomWinRate = rr.winRates["random"] ?? 0;
    let h = 0;
    for (let i = 1; i < nPlayers; i++) {
      const name = `heuristic-${String.fromCharCode(64 + i)}`;
      h += rr.winRates[name] ?? 0;
    }
    heuristicWinRate = h;
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    nPlayers, randomWinRate, heuristicWinRate, baseline,
    delta: randomWinRate - baseline,
    elapsedSec: (Date.now() - tStart) / 1000,
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Random vs heuristic (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);

  const results: CellResult[] = [];
  try {
    for (const n of PLAYER_COUNTS) {
      const r = await runCell(n, pool, t0);
      results.push(r);
    }
  } finally {
    pool.close();
  }

  const lines: string[] = [];
  lines.push(`# Random vs Heuristic — Skill Floor Sanity Check (Track R)`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** establish the heuristic's skill floor. If heuristic CRUSHES random in 3P+ (random << baseline) but lookahead2-multi doesn't beat heuristic, the heuristic IS near-optimal in 3P+ — confirming Sam's "mechanical 3P+" concern. If heuristic doesn't beat random by much, the game has no skill ANYWHERE.`);
  lines.push(``);
  lines.push(`**Methodology:** ${GAMES_PER_CELL} games per cell, random at seat 0 (rotating), heuristic at other seats, variant (c), baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| nPlayers | Baseline | Random win% | Heuristic combined% | Δ (random vs baseline) | Heuristic skill gain |`);
  lines.push(`| ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of results) {
    const skillGain = (r.heuristicWinRate / Math.max(r.nPlayers - 1, 1)) - r.baseline; // avg heuristic vs baseline
    lines.push(`| ${r.nPlayers} | ${(r.baseline * 100).toFixed(1)}% | ${(r.randomWinRate * 100).toFixed(1)}% | ${(r.heuristicWinRate * 100).toFixed(1)}% | ${r.delta >= 0 ? "+" : ""}${(r.delta * 100).toFixed(1)}pp | +${(skillGain * 100).toFixed(1)}pp/seat |`);
  }
  lines.push(``);
  lines.push(`## Interpretation`);
  lines.push(``);
  lines.push(`A random agent in N players gets baseline = 1/N (50% in 2P, 33% in 3P, 25% in 4P). The heuristic's "skill gain" is how much above baseline each heuristic seat wins.`);
  lines.push(``);
  lines.push(`- **If random's Δ ≪ 0 in 3P+** (e.g., random 5% vs 33% baseline): heuristic CRUSHES random → real skill structure exists, and the heuristic captures most of it. Combined with lookahead2-multi at baseline → heuristic IS near-optimal in 3P+ (Sam's worry confirmed).`);
  lines.push(`- **If random's Δ ≈ 0** (e.g., random 30% vs 33% baseline): the game has no skill at all — anyone can win in 3P+. This would mean the game's 3P+ outcomes are noise.`);
  lines.push(`- **If random's Δ is significantly negative AND lookahead2-multi WINS above baseline**: heuristic has real skill structure but lookahead2-multi extracts MORE. The heuristic is NOT optimal — it's just stronger than random.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/random-vs-heuristic.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`random-vs-heuristic aborted: ${e instanceof Error ? e.message : String(e)}`);
});
