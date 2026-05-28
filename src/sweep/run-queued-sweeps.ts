// ABOUTME: run-queued-sweeps — orchestrator that chains the remaining queued sweep scripts in sequence (one heavy compute job at a time).
// ABOUTME: Each step waits for the previous to finish. After all sweeps land, refreshes the dashboard. Self-contained; run with `npx tsx src/sweep/run-queued-sweeps.ts`.

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

interface Step {
  label: string;
  /** Argv to spawn (resolved against process.cwd). */
  cmd: string;
  args: string[];
  /** Path to the JSONL file the step is expected to produce/extend (for confirmation). */
  jsonlPath: string;
}

const STEPS: Step[] = [
  {
    label: "alliance Phase 7 — delta comparison",
    cmd: "npx",
    args: ["tsx", "src/sweep/compare-alliance-deltas.ts"],
    jsonlPath: "docs/sweeps/data/2026-05-28-alliance-deltas.jsonl",
  },
  {
    label: "profile turn complexity (3 scenarios)",
    cmd: "npx",
    args: ["tsx", "src/sweep/profile-turn-complexity.ts"],
    jsonlPath: "docs/sweeps/data/2026-05-28-profile-turn-complexity.jsonl",
  },
];

function timestamp(): string {
  return new Date().toISOString();
}

async function runStep(step: Step): Promise<{ exitCode: number; durationSec: number }> {
  // eslint-disable-next-line no-console
  console.log(`\n[${timestamp()}] === ${step.label} ===`);
  // eslint-disable-next-line no-console
  console.log(`  cmd: ${step.cmd} ${step.args.join(" ")}`);
  const start = Date.now();
  return new Promise((resolveP) => {
    const child = spawn(step.cmd, step.args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code: number | null) => {
      const durationSec = (Date.now() - start) / 1000;
      resolveP({ exitCode: code ?? 1, durationSec });
    });
  });
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[${timestamp()}] === run-queued-sweeps orchestrator ===`);
  // eslint-disable-next-line no-console
  console.log(`Queue (${STEPS.length} steps): ${STEPS.map((s) => s.label).join(" → ")}`);
  for (const step of STEPS) {
    const result = await runStep(step);
    const tag = result.exitCode === 0 ? "OK" : `FAILED (exit ${result.exitCode})`;
    // eslint-disable-next-line no-console
    console.log(`[${timestamp()}] step ${tag} in ${result.durationSec.toFixed(0)}s`);
    if (existsSync(resolve(process.cwd(), step.jsonlPath))) {
      // eslint-disable-next-line no-console
      console.log(`  jsonl: ${step.jsonlPath} (present)`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`  jsonl: ${step.jsonlPath} (MISSING — step may have failed before producing any data)`);
    }
    if (result.exitCode !== 0) {
      // eslint-disable-next-line no-console
      console.error(`!!! step "${step.label}" exited non-zero; continuing to next step.`);
    }
  }
  // After all sweeps, refresh the dashboard.
  // eslint-disable-next-line no-console
  console.log(`\n[${timestamp()}] === Refreshing dashboard ===`);
  try {
    execSync(`npx tsx src/sweep/dashboard.ts`, { stdio: "inherit" });
    // Commit the dashboard refresh.
    execSync(`git add docs/2026-05-28-sweep-dashboard.md`, { stdio: ["ignore", "ignore", "pipe"] });
    execSync(`git commit --quiet -m "dashboard: refresh after queued sweeps complete" || true`, { stdio: ["ignore", "ignore", "pipe"] });
    execSync(`git push --quiet origin HEAD || true`, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`dashboard refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n[${timestamp()}] === Orchestrator complete ===`);
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`run-queued-sweeps aborted: ${err instanceof Error ? err.message : String(err)}`);
});

