import { describe, it, expect } from "vitest";
import { runGame } from "../../src/driver/run";
import { defaultConfig } from "../../src/engine/config";
import type { Archetype } from "../../src/agent/archetypes";

describe("acceptance: agent plays full games", () => {
  it("1000 seeded games across 2-6 players terminate with no illegal actions", () => {
    const archs: Archetype[] = ["aggressive", "economic", "expansionist"];
    let capHits = 0;
    const byType: Record<string, number> = { iron: 0, "last-standing": 0, none: 0 };
    let emptyWinner = 0, realWinner = 0;
    let maxTurns = 0;

    for (let i = 0; i < 1000; i++) {
      const n = 2 + (i % 5); // 2..6
      const res = runGame({
        seed: BigInt(i),
        boardSource: { kind: "generate", size: 96, ironCount: 14 },
        nPlayers: n,
        archetypes: Array.from({ length: n }, (_, k) => archs[k % archs.length]!),
        config: defaultConfig(),
        turnCap: 300,
      });
      // runGame throws on any illegal agent action; reaching here means none did.
      if (res.hitTurnCap) capHits++;
      byType[res.victoryType] = (byType[res.victoryType] ?? 0) + 1;
      if (res.winnerOrCoalition.length === 0) emptyWinner++; else realWinner++;
      if (res.turns > maxTurns) maxTurns = res.turns;
      // every ironOverTime row has length n
      for (const row of res.ironOverTime) expect(row.length).toBe(n);
    }

    // Surface the distribution (the documented finding) in test output.
    // eslint-disable-next-line no-console
    console.log("[acceptance] victoryType:", byType, "emptyWinner:", emptyWinner, "realWinner:", realWinner, "capHits:", capHits, "maxTurns:", maxTurns);

    // Invariants:
    expect(capHits).toBeLessThan(50);            // games terminate (don't hang at the cap)
    // No illegal actions: implied by the loop completing without runGame throwing.
  }, 120_000); // generous timeout for 1000 games
});
