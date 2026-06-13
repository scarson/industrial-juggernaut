// ABOUTME: Tests for recordGame — plays an all-agent game, emits a faithful LogEntry[] + per-boundary stateHash[].
// ABOUTME: Pins setup logging for every seat, single-decl attack + auto endRound, determinism, and self-closing kinds.
import { test, expect } from "vitest";
import { recordGame } from "../../src/session/record";
import { greedyHeader } from "./helpers";

test("recordGame logs a placeFirstBase entry for every seat during setup", () => {
  const out = recordGame(greedyHeader(4), { turnCap: 200 });
  const setupEntries = out.log.filter((e) => e.kind === "placeFirstBase");
  expect(setupEntries).toHaveLength(4);
  expect(new Set(setupEntries.map((e) => e.player)).size).toBe(4); // one per seat
});

test("recordGame is deterministic: same header+turnCap yields an identical log and hashes", () => {
  const a = recordGame(greedyHeader(4), { turnCap: 200 });
  const b = recordGame(greedyHeader(4), { turnCap: 200 });
  expect(a.log).toEqual(b.log);
  expect(a.boundaryHashes).toEqual(b.boundaryHashes);
  expect(a.finalState).toEqual(b.finalState);
});

test("every attack entry is immediately followed by an endRound entry (single-decl auto-close)", () => {
  const out = recordGame(greedyHeader(4), { turnCap: 200 });
  for (let i = 0; i < out.log.length; i++) {
    if (out.log[i]!.kind === "attack") {
      expect(out.log[i + 1]?.kind).toBe("endRound");
    }
  }
});

test("recordGame reaches a real terminal victory for a chosen seed (not turn-capped)", () => {
  // search a few seeds for a decisive game (mirror test/driver/run.test.ts)
  let found = null as ReturnType<typeof recordGame> | null;
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    const out = recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 });
    if (!out.hitTurnCap) { found = out; break; }
  }
  expect(found).not.toBeNull();
  expect(found!.hitTurnCap).toBe(false);
  // boundary hashes: one per round-closing entry.
  const closers = found!.log.filter((e) => e.kind === "build" || e.kind === "pass" || e.kind === "endRound" || e.kind === "roundSkipped").length;
  expect(found!.boundaryHashes).toHaveLength(closers);
});

test("recordGame rejects a human seat (interactive play is plan 2)", () => {
  const header = greedyHeader(2);
  (header.seats as any)[0] = { kind: "human" };
  expect(() => recordGame(header, { turnCap: 50 })).toThrow(/human seat/i);
});

import { runGame } from "../../src/driver/run"; // NOTE: test-only import of the driver — allowed in TESTS, never from src/session/**
import { stepRound } from "../../src/engine/round";
import { status } from "../../src/engine/status";
import { advanceRound, currentPlayer, placeFirstBase, representativeFirstBase } from "../../src/engine/turn";
import { initGame } from "../../src/engine/init";
import { greedyAgent } from "../../src/agent/agent";
import { defaultConfig } from "../../src/engine/config";

// (1) Trusted-code cross-check: recordGame must reach the SAME game OUTCOME as runGame
// (src/driver/run.ts) for the same seed/agents. A wrong rng capture changes combat -> a
// different game -> a different winner/turn-count, which this catches via battle-tested code.
test("recordGame's outcome matches runGame (same seed/agents) — trusted-driver cross-check", () => {
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    const rec = recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 });
    const gr = runGame({ seed: s, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: 4,
      archetypes: ["economic", "economic", "economic", "economic"], config: defaultConfig(), turnCap: 300 });
    expect(rec.finalState.phase.turn).toBe(gr.turns);
    expect(rec.hitTurnCap).toBe(gr.hitTurnCap);
    const st = status(rec.finalState);
    if (gr.victoryType !== "none") {
      expect(st.kind).toBe("victory");
      expect([...(st as any).players].sort()).toEqual([...gr.winnerOrCoalition].sort());
    }
  }
});

// (2) Rigorous full-state pin: recordGame's finalState must DEEP-EQUAL a stepRound-driven
// reference that mirrors src/driver/run.ts's loop exactly (read run.ts:37-128 and match it).
// This proves applyEntry's per-declaration composition == the live stepRound composition.
function referenceFinalState(seed: bigint, n: number, turnCap: number) {
  const agents = Array.from({ length: n }, () => greedyAgent("economic"));
  let state = initGame({ seed, boardSource: { kind: "generate", size: 96, ironCount: 14 }, nPlayers: n, config: defaultConfig() });
  for (let i = 0; i < n; i++) { const p = state.phase.order[state.phase.indexInOrder]!; state = placeFirstBase(state, p, representativeFirstBase(state, p)); }
  if (status(state).kind === "victory") return state;
  for (;;) {
    const p = currentPlayer(state);
    if (!state.players[p]!.eliminated) {
      const choice = agents[p]!(state, p);
      state = stepRound(choice.state, choice.action).state; // post-selection rng is carried in choice.state
    }
    if (status(state).kind === "victory") return state;
    state = advanceRound(state);
    if (state.phase.turn > turnCap) return state;
  }
}

test("recordGame.finalState deep-equals a stepRound-driven live reference (full-state tautology break)", () => {
  for (const s of [1n, 2n, 3n, 7n, 11n]) {
    expect(recordGame(greedyHeader(4, { seed: s }), { turnCap: 300 }).finalState).toEqual(referenceFinalState(s, 4, 300));
  }
});
