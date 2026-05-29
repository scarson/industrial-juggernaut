// ABOUTME: Archetype agents (aggressive, economic, expansionist) vs heuristic on (c) 2P/3P/4P.
// ABOUTME: If any archetype beats heuristic >5pp over baseline, "play a different strategy" works. If all lose, heuristic dominates simple strategies.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS } from "./format";
import { appendResultAndCommit, commitFileAndPush } from "./incremental-results";
import { workerCount } from "./worker-count";
import type { Archetype } from "../agent/archetypes";

const INCREMENTAL_PATH = resolve(process.cwd(), "docs/sweeps/data/2026-05-29-archetype-vs-heuristic.jsonl");
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-29-archetype-vs-heuristic.md");

const BASE_SEED = 27_000n;
const TURN_CAP = 30;
const GAMES_PER_CELL = 50;
const WORKERS = workerCount();
const PLAYER_COUNTS = [2, 3] as const;
const ARCHETYPES: Archetype[] = ["aggressive", "economic", "expansionist"];

const CONFIG_C: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

interface CellResult {
  archetype: Archetype;
  nPlayers: number;
  archetypeWinRate: number;
  heuristicWinRate: number;
  baseline: number;
  delta: number;
  elapsedSec: number;
}

async function runCell(arch: Archetype, nPlayers: number, pool: GamePool, t0: number): Promise<CellResult> {
  const tStart = Date.now();
  const baseline = 1 / nPlayers;
  const label = `${arch}/${nPlayers}P`;
  console.log(`\n-- ${label}, ${GAMES_PER_CELL} games --`);

  const agents: NamedAgentSpec[] = [{ name: arch, spec: { kind: "greedy", archetype: arch } }];
  for (let i = 1; i < nPlayers; i++) {
    agents.push({ name: `heuristic-${String.fromCharCode(64 + i)}`, spec: { kind: "heuristic" } });
  }

  let archWinRate = 0;
  let heurWinRate = 0;
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
              archetype: arch, nPlayers, done, total,
              turns: r.turns, victoryType: r.victoryType,
              winner: r.winnerOrCoalition, hitTurnCap: r.hitTurnCap,
              elapsedSec: (Date.now() - t0) / 1000,
            },
            meta: { label: "archetype-vs-heuristic", done, total, summary },
          });
        },
      },
      pool,
    );
    archWinRate = rr.winRates[arch] ?? 0;
    let h = 0;
    for (let i = 1; i < nPlayers; i++) {
      const name = `heuristic-${String.fromCharCode(64 + i)}`;
      h += rr.winRates[name] ?? 0;
    }
    heurWinRate = h;
  } catch (e) {
    console.error(`  ${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    archetype: arch, nPlayers, archetypeWinRate: archWinRate,
    heuristicWinRate: heurWinRate, baseline, delta: archWinRate - baseline,
    elapsedSec: (Date.now() - tStart) / 1000,
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Archetypes vs heuristic (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);

  const results: CellResult[] = [];
  try {
    for (const arch of ARCHETYPES) {
      for (const n of PLAYER_COUNTS) {
        const r = await runCell(arch, n, pool, t0);
        results.push(r);
      }
    }
  } finally {
    pool.close();
  }

  const lines: string[] = [];
  lines.push(`# Archetype Strategies vs Heuristic`);
  lines.push(``);
  lines.push(`**Date:** 2026-05-29. **Trigger:** can any simple "play a specific role" strategy (aggressive / economic / expansionist) beat the perimeter-aware heuristic? If yes, the game has multiple viable strategies — diverse skill expression. If all lose, the heuristic dominates simple strategies and the only way up is more search.`);
  lines.push(``);
  lines.push(`**Methodology:** ${GAMES_PER_CELL} games per cell, variant (c), baseSeed ${BASE_SEED}.`);
  lines.push(``);
  lines.push(`## Results`);
  lines.push(``);
  lines.push(`| Archetype | nP | Baseline | Win% | Δ vs baseline | Verdict |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | --- |`);
  for (const r of results) {
    const verdict = r.delta > 0.05 ? "**competitive**" : r.delta < -0.10 ? "loses badly" : "near baseline";
    lines.push(`| ${r.archetype} | ${r.nPlayers} | ${(r.baseline * 100).toFixed(1)}% | ${(r.archetypeWinRate * 100).toFixed(1)}% | ${r.delta >= 0 ? "+" : ""}${(r.delta * 100).toFixed(1)}pp | ${verdict} |`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Generated by \`src/sweep/archetype-vs-heuristic.ts\`.*`);
  const md = lines.join("\n") + "\n";
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, "utf8");
  commitFileAndPush(OUT_PATH, `report: ${OUT_PATH.split("/").pop()}`);
  console.log(`\nDone in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
}

main().catch((e: unknown) => {
  console.error(`archetype-vs-heuristic aborted: ${e instanceof Error ? e.message : String(e)}`);
});
