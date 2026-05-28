// ABOUTME: overnight-2 — chained orchestrator for the 2026-05-29 overnight queue (Tracks A + E + B + C).
// ABOUTME: Sequentially runs the lookahead2 generality sweeps, longer-game regime grid, MCTS recovery curve.

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const STEPS: { label: string; script: string }[] = [
  // Track A — lookahead2 vs heuristic across variants & player counts.
  { label: "A1: lookahead2 vs heuristic, (c) 2P, 300 games", script: "src/sweep/lookahead2-vs-heuristic-c-2p.ts" },
  { label: "A2: lookahead2 vs heuristic, (c) 3P, 150 games", script: "src/sweep/lookahead2-vs-heuristic-c-3p.ts" },
  { label: "A3: lookahead2 vs heuristic, (c) 4P, 100 games", script: "src/sweep/lookahead2-vs-heuristic-c-4p.ts" },
  { label: "A4: lookahead2 vs heuristic, default variant 2P, 200 games", script: "src/sweep/lookahead2-vs-heuristic-default-2p.ts" },
  // Track E — longer-game regime grid.
  { label: "E: longer-game regime grid (boardSize x victoryThreshold)", script: "src/sweep/longer-game-regime-grid.ts" },
  // Track B — MCTS recovery curve.
  { label: "B1: MCTS@500 vs heuristic, (c) 2P, 48 games", script: "src/sweep/mcts-recovery-b1.ts" },
  { label: "B2: MCTS@1000 vs heuristic, (c) 2P, 32 games", script: "src/sweep/mcts-recovery-b2.ts" },
  { label: "B3: lookahead2 vs MCTS@500, (c) 2P, 32 games", script: "src/sweep/mcts-recovery-b3.ts" },
];

function ts(): string { return new Date().toISOString(); }

function runStep(label: string, script: string, idx: number, total: number): { ok: boolean; durationSec: number } {
  const t0 = Date.now();
  const cmd = `npx tsx ${script}`;
  console.log(`\n[${ts()}] === step ${idx + 1}/${total}: ${label} ===`);
  console.log(`  cmd: ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
    const sec = Math.round((Date.now() - t0) / 1000);
    console.log(`[${ts()}] step OK in ${sec}s`);
    return { ok: true, durationSec: sec };
  } catch (e) {
    const sec = Math.round((Date.now() - t0) / 1000);
    console.error(`[${ts()}] step FAILED in ${sec}s: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, durationSec: sec };
  }
}

function refreshDashboard(): void {
  console.log(`\n[${ts()}] === Refreshing dashboard ===`);
  try {
    execSync("npx tsx src/sweep/dashboard.ts", { stdio: "inherit", cwd: process.cwd() });
  } catch (e) {
    console.error(`dashboard refresh failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function main(): void {
  console.log(`[${ts()}] === overnight-2 orchestrator (${STEPS.length} steps queued) ===`);
  // Filter to existing scripts (some may not be implemented yet; skip cleanly).
  const have = STEPS.filter((s) => existsSync(resolve(process.cwd(), s.script)));
  const skipped = STEPS.filter((s) => !existsSync(resolve(process.cwd(), s.script)));
  if (skipped.length > 0) {
    console.log(`  Skipped (script not present): ${skipped.map((s) => s.label).join(" | ")}`);
  }

  const results: { label: string; ok: boolean; durationSec: number }[] = [];
  for (let i = 0; i < have.length; i++) {
    const s = have[i]!;
    const { ok, durationSec } = runStep(s.label, s.script, i, have.length);
    results.push({ label: s.label, ok, durationSec });
    refreshDashboard();
  }

  console.log(`\n[${ts()}] === Orchestrator complete ===`);
  for (const r of results) {
    console.log(`  ${r.ok ? "OK " : "FAIL"} ${String(r.durationSec).padStart(5)}s  ${r.label}`);
  }
}

main();
