// ABOUTME: MCTS re-validation (npx tsx src/sweep/revalidate.ts [--workers N]) — re-checks the calibration's balanced config under strong (MCTS) play.
// ABOUTME: Part A: does the config stay healthy under all-MCTS play? Part B (gate 2): does MCTS beat the heuristic agent head-to-head? Runs games in parallel via a GamePool.

import { isHealthy, defaultHealthThresholds } from "./health";
import { fmtMetrics, elapsedS } from "./format";
import { GamePool } from "./pool";
import { runConfigParallel, roundRobinParallel, type NamedAgentSpec } from "./run-parallel";
import { defaultConfig, type RuleConfig } from "../engine/config";

const BASE_SEED = 1_000n;

/**
 * Turn cap for the re-validation. Bounded (not the 100 the greedy reference used)
 * because all-MCTS self-play can STALEMATE — two strong players each avoid losing
 * and neither can force a win — running to the cap. A bounded cap turns that into
 * an observable `capHitFraction` signal instead of a multi-hour hang.
 */
const TURN_CAP = 60;

/**
 * MCTS search budget for the re-validation (vs the 300 arena default). 100 keeps
 * all-MCTS games tractable while still playing markedly stronger than the greedy
 * heuristic — enough to answer "does strong play change the game's character?".
 */
const MCTS_ITERS = 100;

/** Worker processes (default 4 = all cores; the parent is I/O-bound awaiting results). Override with `--workers N`. */
function workerCount(): number {
  const i = process.argv.indexOf("--workers");
  if (i >= 0 && process.argv[i + 1] !== undefined) {
    const n = Number(process.argv[i + 1]);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 4;
}

/** The calibration's recommended balanced config (radius 5 -> 2 is the decisive knob). */
const CONFIG: RuleConfig = { ...defaultConfig(), boardSize: 96, radius: 2, ironCount: 12, victoryThreshold: 12 };

/** Greedy-baseline reference metrics for this config (from docs/sweeps/2026-05-27-calibration-report.md, 600 games). */
const GREEDY_REF = "greedy@600: med=3 cap=0.02 setup=0.00 iron=0.79 seat=0.17 lead=0.35 (PASS)";

/** Games for the all-MCTS health re-check. MCTS is slow, so this is modest; the question is whether length/health survives strong play, not a tight CI. */
const HEALTH_GAMES = 12;

/** Player counts for the health re-check. Restricted to 2-3P: 4P+ all-MCTS games can run to the turn cap (stalemate) and dominate wall-clock without changing the "does strong play collapse or stalemate the game?" answer. */
const HEALTH_PLAYER_COUNTS = [2, 3];

/** 2-player head-to-head games (gate 2). Seat-rotated so first-mover bias averages out. */
const H2H_GAMES = 24;

async function main(): Promise<void> {
  const t0 = Date.now();
  const thresholds = defaultHealthThresholds();
  const workers = workerCount();
  const pool = new GamePool(workers);
  console.log("=== MCTS re-validation of the balanced config ===");
  console.log(`config: boardSize=96 radius=2 ironCount=12 victoryThreshold=12`);
  console.log(`baseSeed=${BASE_SEED} turnCap=${TURN_CAP} mctsIters=${MCTS_ITERS} healthGames=${HEALTH_GAMES} (counts ${HEALTH_PLAYER_COUNTS.join(",")}) h2hGames=${H2H_GAMES} workers=${workers}`);
  console.log(`reference ${GREEDY_REF}`);

  try {
    // --- Part A: health under all-MCTS play (games run in parallel across workers). ---
    console.log("\n--- Part A: health under all-MCTS play ---");
    const mctsMetrics = await runConfigParallel(
      CONFIG,
      {
        games: HEALTH_GAMES,
        turnCap: TURN_CAP,
        baseSeed: BASE_SEED,
        playerCounts: HEALTH_PLAYER_COUNTS,
        agentSpec: { kind: "mcts", iterations: MCTS_ITERS },
        onGame: (done, total, nPlayers, result) => {
          const winner = result.winnerOrCoalition.length === 0 ? "none(cap)" : result.winnerOrCoalition.join("+");
          console.log(`  [game ${done}/${total}] ${nPlayers}P -> turns=${result.turns} ${result.victoryType} winner=${winner} (${elapsedS(t0)})`);
        },
      },
      pool,
    );
    const verdict = isHealthy(mctsMetrics, thresholds);
    console.log(`mcts@${HEALTH_GAMES}: ${fmtMetrics(mctsMetrics)} ${verdict.pass ? "PASS" : `FAIL: ${verdict.reasons.join("; ")}`} (${elapsedS(t0)})`);
    console.log(
      `  (note: at ${HEALTH_GAMES} games seatBias/leadVol have wide CIs; the load-bearing checks here are medianTurns staying multi-turn and ironVictory staying dominant — i.e. strong play does NOT collapse the game to turn 1.)`,
    );

    // --- Part B: gate 2 — MCTS vs heuristic head-to-head (2P, seat-rotated, parallel). ---
    console.log("\n--- Part B: gate 2 — MCTS vs heuristic (2P head-to-head) ---");
    const agents: NamedAgentSpec[] = [
      { name: "mcts", spec: { kind: "mcts", iterations: MCTS_ITERS } },
      { name: "heuristic", spec: { kind: "heuristic" } },
    ];
    const rr = await roundRobinParallel(
      agents,
      {
        playerCounts: [2],
        gamesPerMatchup: H2H_GAMES,
        seed: BASE_SEED,
        config: CONFIG,
        turnCap: TURN_CAP,
        onGame: (done, total, _pc, result) => {
          const winner = result.winnerOrCoalition.length === 0 ? "none(cap)" : result.winnerOrCoalition.join("+");
          console.log(`  [h2h ${done}/${total}] turns=${result.turns} ${result.victoryType} winnerSeat=${winner} (${elapsedS(t0)})`);
        },
      },
      pool,
    );
    const mctsWin = rr.winRates["mcts"] ?? 0;
    const heurWin = rr.winRates["heuristic"] ?? 0;
    const decisive = (rr.headToHead["mcts"]?.["heuristic"] ?? 0) + (rr.headToHead["heuristic"]?.["mcts"] ?? 0);
    console.log(
      `mcts winRate=${mctsWin.toFixed(3)} vs heuristic winRate=${heurWin.toFixed(3)} over ${H2H_GAMES} games ` +
        `(decisive ${decisive}; mcts H2H wins ${rr.headToHead["mcts"]?.["heuristic"] ?? 0}, heuristic H2H wins ${rr.headToHead["heuristic"]?.["mcts"] ?? 0}). (${elapsedS(t0)})`,
    );
    console.log(`mcts elo=${(rr.elo["mcts"] ?? 0).toFixed(0)} heuristic elo=${(rr.elo["heuristic"] ?? 0).toFixed(0)}`);

    // --- Summary. ---
    console.log(`\n=== Re-validation summary (${elapsedS(t0)}) ===`);
    console.log(`A (health under MCTS): ${verdict.pass ? "PASS" : "FAIL — " + verdict.reasons.join("; ")}`);
    const gate2 = mctsWin > heurWin;
    console.log(`B (gate 2, MCTS beats heuristic): ${gate2 ? "PASS" : "FAIL"} (mcts ${mctsWin.toFixed(3)} vs heuristic ${heurWin.toFixed(3)})`);
  } finally {
    pool.close();
  }
}

void main().catch((err: unknown) => {
  // Fail loud but clean (e.g. a worker dying mid-job rejects here) rather than a raw unhandled-rejection trace.
  console.error(`revalidation aborted: ${err instanceof Error ? err.message : String(err)}`);
});
