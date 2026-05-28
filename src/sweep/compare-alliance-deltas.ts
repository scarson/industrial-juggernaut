// ABOUTME: compare-alliance-deltas — sweeps the alliance feature at varying allianceVictoryDelta values.
// ABOUTME: Uses a scripted ally-eager agent to force alliances; measures effect on game length, victory mix, anti-gang-up.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GamePool } from "./pool";
import { runConfigParallel } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { elapsedS, fmtMetrics } from "./format";
import type { SweepMetrics } from "./metrics";

const BASE_SEED = 8_000n;
const TURN_CAP = 60;
const GAMES = 150;
const WORKERS = 4;
const PLAYER_COUNTS = [3, 4]; // alliances need >= 3 players to matter
const OUT_PATH = resolve(process.cwd(), "docs/2026-05-28-alliance-comparison.md");

/** Variant (c) geometry as the base config; alliance flags vary per variant below. */
const BASE_CONFIG: RuleConfig = {
  ...defaultConfig(),
  boardSize: 96,
  radius: 2,
  ironCount: 14,
  victoryThreshold: 10,
  noIronRequiresPerimeter: true,
};

interface AllianceVariant {
  label: string;
  description: string;
  flags: Partial<RuleConfig>;
  agentLabel: string;
}

// Variants — comparing the anti-coalition delta across reasonable values plus a baseline (alliances off).
// We use a heuristic agent (which won't strategically choose alliance actions but may fall back to them
// when other options aren't available). The data here is *mechanical* — verifying alliance feature
// behaves and the anti-coalition threshold actually constrains coalition victories.
const VARIANTS: AllianceVariant[] = [
  { label: "alliances OFF (baseline)", description: "No alliances available; heuristic self-play.", flags: { alliancesEnabled: false }, agentLabel: "heuristic" },
  { label: "alliances ON, delta=2", description: "Alliances enabled, +2 iron per ally member needed for coalition victory.", flags: { alliancesEnabled: true, allianceVictoryDelta: 2 }, agentLabel: "heuristic" },
  { label: "alliances ON, delta=3", description: "Alliances enabled, +3 iron per ally member.", flags: { alliancesEnabled: true, allianceVictoryDelta: 3 }, agentLabel: "heuristic" },
  { label: "alliances ON, delta=4 (default)", description: "Alliances enabled, +4 iron per ally member (proposed default).", flags: { alliancesEnabled: true, allianceVictoryDelta: 4 }, agentLabel: "heuristic" },
  { label: "alliances ON, delta=5", description: "Alliances enabled, +5 iron per ally member (more aggressive anti-gang-up).", flags: { alliancesEnabled: true, allianceVictoryDelta: 5 }, agentLabel: "heuristic" },
];

interface VariantResult {
  variant: AllianceVariant;
  metrics: SweepMetrics | null;
  elapsedSec: number;
}

async function runVariant(variant: AllianceVariant, pool: GamePool, t0: number): Promise<VariantResult> {
  const tStart = Date.now();
  const config: RuleConfig = { ...BASE_CONFIG, ...variant.flags };

  console.log(`\n=== ${variant.label} ===`);
  let metrics: SweepMetrics | null = null;
  try {
    metrics = await runConfigParallel(
      config,
      {
        games: GAMES,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: PLAYER_COUNTS,
        agentSpec: { kind: "heuristic" },
        onGame: (done, total, n, r) => {
          if (done % 25 === 0 || done === total) {
            const w = r.winnerOrCoalition.length === 0 ? "none" : r.winnerOrCoalition.join("+");
            console.log(`  [${variant.label} ${done}/${total}] ${n}P -> t=${r.turns} ${r.victoryType} w=${w} (${elapsedS(t0)})`);
          }
        },
      },
      pool,
    );
  } catch (err) {
    console.error(`  ${variant.label} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { variant, metrics, elapsedSec: (Date.now() - tStart) / 1000 };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const pool = new GamePool(WORKERS);
  console.log(`=== Alliance-delta comparison sweep (baseSeed ${BASE_SEED}, ${WORKERS} workers) ===`);
  console.log(`Common config: boardSize=96 radius=2 ironCount=14 victoryThreshold=10 noIronRequiresPerimeter=true`);
  console.log(`Player counts: ${PLAYER_COUNTS.join(",")}; games/variant: ${GAMES}`);

  try {
    const results: VariantResult[] = [];
    for (const v of VARIANTS) {
      const r = await runVariant(v, pool, t0);
      results.push(r);
    }

    // --- Report ---
    const lines: string[] = [];
    lines.push(`# Alliance-Delta Comparison Sweep`);
    lines.push(``);
    lines.push(`**Date:** 2026-05-28 (overnight). **Trigger:** Alliance layer Phase 7 — measure mechanical effect of varying allianceVictoryDelta in 3-4P games on the variant-(c) geometry.`);
    lines.push(``);
    lines.push(`**Caveat:** heuristic agent doesn't reason about alliances; this measures incidental alliance formation (via samplePolicy fallback when builds/attacks aren't candidates), NOT strategic alliance use. The right strategic test is playtest or an alliance-aware agent (deferred follow-up).`);
    lines.push(``);
    lines.push(`## Verdict matrix`);
    lines.push(``);
    lines.push(`| Variant | Median turns | Iron-vic | Last-standing | CapHit | Setup-decided | Notes |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const r of results) {
      if (r.metrics === null) {
        lines.push(`| ${r.variant.label} | — | — | — | — | — | FAILED |`);
        continue;
      }
      const vt = r.metrics.victoryType;
      const lsFraction = ((vt["last-standing"] ?? 0) / r.metrics.gamesPlayed).toFixed(2);
      lines.push(`| ${r.variant.label} | ${r.metrics.medianTurns} | ${r.metrics.ironVictoryFraction.toFixed(2)} | ${lsFraction} | ${r.metrics.capHitFraction.toFixed(2)} | ${r.metrics.setupDecidedFraction.toFixed(2)} | ${r.elapsedSec.toFixed(0)}s |`);
    }
    lines.push(``);
    lines.push(`## Per-variant detail`);
    for (const r of results) {
      lines.push(``);
      lines.push(`### ${r.variant.label}`);
      lines.push(``);
      lines.push(r.variant.description);
      if (r.metrics) {
        lines.push(`**Metrics:** ${fmtMetrics(r.metrics)}`);
        const vt = r.metrics.victoryType;
        lines.push(`**Victory mix:** iron=${vt.iron ?? 0}, last-standing=${vt["last-standing"] ?? 0}, none(cap)=${vt.none ?? 0} of ${r.metrics.gamesPlayed} games.`);
      }
    }
    lines.push(``);
    lines.push(`## Interpretation notes (auto-flagged)`);
    const baselineMetrics = results[0]!.metrics;
    if (baselineMetrics === null) {
      lines.push(`- Baseline failed; no comparative interpretation possible.`);
    } else {
      const baseIron = baselineMetrics.ironVictoryFraction;
      for (let i = 1; i < results.length; i++) {
        const r = results[i]!;
        if (r.metrics === null) continue;
        const deltaIron = r.metrics.ironVictoryFraction - baseIron;
        const sign = deltaIron > 0 ? "+" : "";
        lines.push(`- **${r.variant.label}**: iron-vic ${sign}${deltaIron.toFixed(2)} vs baseline.`);
      }
      lines.push(`- A *successful* anti-coalition delta tightens iron victories vs. baseline (harder for any coalition to win the iron race). If delta values >0 produce LOWER iron-vic than baseline, the safeguard is working as intended.`);
      lines.push(`- **Strategic-richness caveat (re-stated):** heuristic doesn't actively use alliances. This sweep verifies the SAFEGUARD'S MATH, not the alliance dynamic itself.`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(`*Generated by \`src/sweep/compare-alliance-deltas.ts\`.*`);
    const md = lines.join("\n") + "\n";
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, md, "utf8");
    console.log(`\nAll done in ${elapsedS(t0)}. Report: ${OUT_PATH}`);
  } finally {
    pool.close();
  }
}

void main().catch((err: unknown) => {
  console.error(`compare-alliance-deltas aborted: ${err instanceof Error ? err.message : String(err)}`);
});
