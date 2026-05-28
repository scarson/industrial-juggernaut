// ABOUTME: profile-turn-complexity — instruments a played-out game and logs legalActions count + elapsed time per round.
// ABOUTME: Answers "are late-game decisions forced (legal-actions shrinks) or expanding (combinatorial growth in attacks)?" — disambiguator for the long-game-engagement question.

import { generateBoard } from "../board/generate";
import { setupGame, advanceRound, currentPlayer } from "../engine/turn";
import { status } from "../engine/status";
import { stepRound } from "../engine/round";
import { legalActions } from "../engine/legal";
import { control } from "../engine/control";
import { coalitionIron } from "../engine/status";
import { mctsAgent, defaultMctsParams } from "../agent/mcts-agent";
import { heuristicAgent } from "../agent/heuristic-agent";
import { defaultConfig, type RuleConfig } from "../engine/config";
import { seed } from "../rng/pcg";
import type { Agent } from "../agent/agent";
import type { GameState } from "../engine/types";

interface RoundLog {
  turn: number;
  playerActed: number;
  legalActionsForActed: number;
  elapsedMs: number;
  bases: number[];        // per-player base count
  factories: number[];    // per-player factory count
  controlledIron: number[]; // per-player controlled iron count
}

interface RunSpec {
  label: string;
  config: RuleConfig;
  nPlayers: number;
  gameSeed: bigint;
  turnCap: number;
  agentFor: (player: number) => Agent;
}

function playInstrumentedGame(spec: RunSpec): { rounds: RoundLog[]; finalTurns: number; victoryType: string; winner: number[] } {
  const { board, rng } = generateBoard(seed(spec.gameSeed), { size: spec.config.boardSize, ironCount: spec.config.ironCount });
  let state: GameState = setupGame(rng, board, spec.nPlayers, spec.config);
  const rounds: RoundLog[] = [];

  // Check status at setup; early termination is rare but possible.
  const initialStatus = status(state);
  if (initialStatus.kind === "victory") {
    return { rounds: [], finalTurns: state.phase.turn, victoryType: initialStatus.reason, winner: initialStatus.players };
  }

  while (state.phase.turn <= spec.turnCap) {
    const player = currentPlayer(state);
    if (state.players[player]!.eliminated) {
      state = advanceRound(state);
      continue;
    }

    const tStart = Date.now();
    const legalCount = legalActions(state).length;
    const agent = spec.agentFor(player);
    if (legalCount === 0) {
      // The robustness fix's territory: agent would either return legal[0] (none here) or throw.
      console.log(`  STRANDED: player ${player} has 0 legal actions at turn ${state.phase.turn}. Aborting game.`);
      break;
    }
    const choice = agent(state, player);
    state = choice.state;
    state = stepRound(state, choice.action).state;
    const elapsedMs = Date.now() - tStart;

    const bases = state.players.map((p) => state.bases.filter((b) => b.owner === p.id).length);
    const factories = state.players.map((p) => control(state, p.id).factories.length);
    const ironCounts = state.players.map((p) => coalitionIron(state, [p.id]));
    rounds.push({
      turn: state.phase.turn,
      playerActed: player,
      legalActionsForActed: legalCount,
      elapsedMs,
      bases,
      factories,
      controlledIron: ironCounts,
    });

    const st = status(state);
    if (st.kind === "victory") {
      return { rounds, finalTurns: state.phase.turn, victoryType: st.reason, winner: st.players };
    }

    state = advanceRound(state);
  }
  return { rounds, finalTurns: state.phase.turn, victoryType: "none(cap)", winner: [] };
}

function summarize(label: string, result: ReturnType<typeof playInstrumentedGame>): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Game ended at turn ${result.finalTurns}: ${result.victoryType} winner=${JSON.stringify(result.winner)}`);
  console.log(`Total rounds: ${result.rounds.length}\n`);
  console.log("turn | actor | legalCnt |  ms | basesP0/P1 | factP0/P1 | ironP0/P1");
  console.log("-----+-------+----------+-----+------------+-----------+----------");
  for (const r of result.rounds) {
    const b = r.bases.slice(0, 2).join("/");
    const f = r.factories.slice(0, 2).join("/");
    const i = r.controlledIron.slice(0, 2).join("/");
    console.log(`  ${String(r.turn).padStart(2)} |   P${r.playerActed}  | ${String(r.legalActionsForActed).padStart(8)} | ${String(r.elapsedMs).padStart(3)} |   ${b.padEnd(8)} | ${f.padEnd(7)} |   ${i.padEnd(6)}`);
  }
  // Per-turn aggregates (averaged across players within a turn).
  const byTurn = new Map<number, { count: number; legal: number; ms: number }>();
  for (const r of result.rounds) {
    const cur = byTurn.get(r.turn) ?? { count: 0, legal: 0, ms: 0 };
    cur.count += 1;
    cur.legal += r.legalActionsForActed;
    cur.ms += r.elapsedMs;
    byTurn.set(r.turn, cur);
  }
  console.log(`\nPer-turn averages (legalActions, ms):`);
  for (const [t, agg] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  turn ${String(t).padStart(2)}: legalAvg=${(agg.legal / agg.count).toFixed(0)}  msAvg=${(agg.ms / agg.count).toFixed(0)}`);
  }
}

async function main(): Promise<void> {
  // The variant-(c) config that produced 12-turn MCTS games in the comparison run.
  const cfgC: RuleConfig = { ...defaultConfig(), boardSize: 96, radius: 2, ironCount: 14, victoryThreshold: 10, noIronRequiresPerimeter: true };
  // Baseline for comparison.
  const cfgBaseline: RuleConfig = { ...defaultConfig(), boardSize: 96, radius: 2, ironCount: 12, victoryThreshold: 12 };

  const mcts100 = mctsAgent({ ...defaultMctsParams(), iterations: 100 });
  const heur = heuristicAgent();

  // 1. Variant (c), 2P all-MCTS — the long-game scenario we're worried about.
  summarize("Variant (c) 2P all-MCTS — long-game scenario", playInstrumentedGame({
    label: "c-mcts",
    config: cfgC,
    nPlayers: 2,
    gameSeed: 5_000n + 5n, // a seed that yielded a multi-turn game in the comparison run
    turnCap: 60,
    agentFor: () => mcts100,
  }));

  // 2. Variant (c), 2P MCTS-vs-heuristic — most of these are t=2 iron wins per the comparison.
  summarize("Variant (c) 2P MCTS(seat0) vs heuristic(seat1)", playInstrumentedGame({
    label: "c-vs-heur",
    config: cfgC,
    nPlayers: 2,
    gameSeed: 5_000n,
    turnCap: 60,
    agentFor: (p) => (p === 0 ? mcts100 : heur),
  }));

  // 3. Baseline 2P all-MCTS — the turn-1 collapse scenario.
  summarize("Baseline 2P all-MCTS — turn-1 collapse scenario", playInstrumentedGame({
    label: "baseline-mcts",
    config: cfgBaseline,
    nPlayers: 2,
    gameSeed: 5_000n,
    turnCap: 60,
    agentFor: () => mcts100,
  }));
}

void main().catch((err: unknown) => {
  console.error(`profile-turn-complexity aborted: ${err instanceof Error ? err.message : String(err)}`);
});
