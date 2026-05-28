// ABOUTME: Tests for turn.ts — setupGame seating, currentPlayer, advanceRound rotation/rollover, turn-order draws.
// ABOUTME: Structural assertions; every randomized path is seeded (testing-pitfalls §8). Pure functions only.

import { describe, it, expect } from "vitest";
import { generateBoard } from "../../src/board/generate";
import { seed } from "../../src/rng/pcg";
import { hex, key } from "../../src/geometry/cube";
import { ringDepthFromEdge } from "../../src/board/shape";
import { defaultConfig } from "../../src/engine/config";
import { setupGame, currentPlayer, advanceRound } from "../../src/engine/turn";
import { mkState } from "../helpers/state";
import type { Base, GameState } from "../../src/engine/types";

// 10 iron hexes within radius 5 of origin (radiating disk under defaults).
const TEN_IRON = [
  hex(1, -1, 0), hex(2, -2, 0), hex(3, -3, 0), hex(4, -4, 0), hex(5, -5, 0),
  hex(0, 1, -1), hex(0, 2, -2), hex(0, 3, -3), hex(0, 4, -4), hex(0, 5, -5),
];

const cfg = defaultConfig();

function mkBoard(size = 96) {
  return generateBoard(seed(1n), { size, ironCount: cfg.ironCount }).board;
}

describe("setupGame", () => {
  it("creates nPlayers players with basesInHand === baseLimit-1", () => {
    const board = mkBoard();
    const s = setupGame(seed(7n), board, 4, cfg);
    expect(s.players.length).toBe(4);
    s.players.forEach((p, i) => {
      expect(p.id).toBe(i);
      expect(p.basesInHand).toBe(cfg.baseLimit - 1);
      expect(p.alliance).toEqual([i]);
      expect(p.eliminated).toBe(false);
    });
  });

  it("places exactly one fresh base per player on a distinct outer-ring hex", () => {
    const board = mkBoard();
    const n = 5;
    const s = setupGame(seed(7n), board, n, cfg);
    expect(s.bases.length).toBe(n);

    const seen = new Set<string>();
    for (let id = 0; id < n; id++) {
      const owned = s.bases.filter((b) => b.owner === id);
      expect(owned.length).toBe(1);
      const b = owned[0] as Base;
      expect(b.state).toBe("fresh");
      expect(b.order).toBe(id);
      // outer ring: ringDepthFromEdge === 0
      expect(ringDepthFromEdge(b.hex, board.hexes)).toBe(0);
      // distinct hex
      expect(seen.has(key(b.hex))).toBe(false);
      seen.add(key(b.hex));
    }
  });

  it("sets factorySupply to config.factorySupply and no factories", () => {
    const board = mkBoard();
    const s = setupGame(seed(7n), board, 3, cfg);
    expect(s.factorySupply).toBe(cfg.factorySupply);
    expect(s.factorySupply).toBe(36);
    expect(s.factories).toEqual([]);
  });

  it("starts at turn 1, indexInOrder 0, with order a permutation of all ids", () => {
    const board = mkBoard();
    const n = 6;
    const s = setupGame(seed(7n), board, n, cfg);
    expect(s.phase.turn).toBe(1);
    expect(s.phase.indexInOrder).toBe(0);
    const sorted = [...s.phase.order].sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("is deterministic: same seed => identical setup (base hexes + order + turn order)", () => {
    const board = mkBoard();
    const a = setupGame(seed(42n), board, 4, cfg);
    const b = setupGame(seed(42n), board, 4, cfg);
    expect(a.phase.order).toEqual(b.phase.order);
    const aKeys = a.bases.map((x) => `${x.owner}:${key(x.hex)}:${x.order}`);
    const bKeys = b.bases.map((x) => `${x.owner}:${key(x.hex)}:${x.order}`);
    expect(aKeys).toEqual(bKeys);
    expect(a.rngState).toEqual(b.rngState);
  });

  it("differing seeds can produce a different turn order (PRNG actually consumed)", () => {
    const board = mkBoard();
    // We don't require difference for every pair, but the rngState must advance
    // from the input seed (rng threaded forward, GEO-3).
    const s = setupGame(seed(1n), board, 4, cfg);
    expect(s.rngState).not.toEqual(seed(1n));
  });
});

describe("currentPlayer", () => {
  it("returns order[indexInOrder]", () => {
    const board = mkBoard();
    const s = setupGame(seed(7n), board, 4, cfg);
    expect(currentPlayer(s)).toBe(s.phase.order[s.phase.indexInOrder]);
    const s2: GameState = { ...s, phase: { ...s.phase, indexInOrder: 2 } };
    expect(currentPlayer(s2)).toBe(s2.phase.order[2]);
  });
});

describe("advanceRound intra-turn", () => {
  it("advances indexInOrder by 1, same turn, bases unchanged", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 3, cfg);
    // Fatigue a base; an intra-turn advance must NOT refresh it.
    const s: GameState = {
      ...s0,
      bases: s0.bases.map((b, i) => (i === 0 ? { ...b, state: "fatigued" } : b)),
      phase: { ...s0.phase, indexInOrder: 0 },
    };
    const next = advanceRound(s);
    expect(next.phase.turn).toBe(s.phase.turn);
    expect(next.phase.indexInOrder).toBe(1);
    expect(next.phase.order).toEqual(s.phase.order); // same order within a turn
    expect(next.bases).toEqual(s.bases); // unchanged, fatigued base still fatigued
    expect(next.bases[0]?.state).toBe("fatigued");
  });
});

describe("advanceRound rollover", () => {
  it("starts a new turn, resets indexInOrder, refreshes ALL bases to fresh", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 3, cfg);
    // Put us at the last index of the turn, with a fatigued base.
    const s: GameState = {
      ...s0,
      bases: s0.bases.map((b) => ({ ...b, state: "fatigued" })),
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
    };
    const next = advanceRound(s);
    expect(next.phase.turn).toBe(s.phase.turn + 1);
    expect(next.phase.indexInOrder).toBe(0);
    // All bases refreshed at start of new turn.
    expect(next.bases.every((b) => b.state === "fresh")).toBe(true);
    // A fresh order over all (live) players was drawn.
    const sorted = [...next.phase.order].sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 2]);
  });

  it("excludes eliminated players from the freshly-drawn order", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 4, cfg);
    const s: GameState = {
      ...s0,
      players: s0.players.map((p) => (p.id === 2 ? { ...p, eliminated: true } : p)),
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
    };
    const next = advanceRound(s);
    expect(next.phase.order).not.toContain(2);
    const sorted = [...next.phase.order].sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1, 3]);
  });

  it("when only one live player remains, the new order is just that player", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 4, cfg);
    const s: GameState = {
      ...s0,
      players: s0.players.map((p) => (p.id === 1 ? p : { ...p, eliminated: p.id !== 1 })),
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
    };
    const next = advanceRound(s);
    expect(next.phase.order).toEqual([1]);
  });
});

describe("turn-order rule (3+ players): last & second-to-last go first", () => {
  it("previous last and second-to-last occupy the first two slots of the new order", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 5, cfg);
    // Craft a known completed turn order. Last two = 1 (second-to-last), 4 (last).
    const completedOrder = [3, 0, 2, 1, 4];
    const s: GameState = {
      ...s0,
      phase: { turn: 2, order: completedOrder, indexInOrder: completedOrder.length - 1 },
    };
    // Try across several seeds: the FIRST TWO slots must always be {1,4} (some order),
    // and the remaining slots must be the rest of the live players.
    for (const seedN of [0n, 1n, 2n, 3n, 10n, 99n]) {
      const advanced: GameState = { ...s, rngState: seed(seedN) };
      const next = advanceRound(advanced);
      const firstTwo = new Set(next.phase.order.slice(0, 2));
      expect(firstTwo).toEqual(new Set([1, 4]));
      const sortedAll = [...next.phase.order].sort((a, b) => a - b);
      expect(sortedAll).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("if a 'last' player was eliminated, falls back to next-latest live player", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 5, cfg);
    // Completed order ...; last=4 eliminated, second-to-last=1. Next-latest live = 2.
    const completedOrder = [3, 0, 2, 1, 4];
    const s: GameState = {
      ...s0,
      players: s0.players.map((p) => (p.id === 4 ? { ...p, eliminated: true } : p)),
      phase: { turn: 2, order: completedOrder, indexInOrder: completedOrder.length - 1 },
    };
    const next = advanceRound({ ...s, rngState: seed(5n) });
    // Live players: 0,1,2,3. The two latest live in completedOrder are 1 (idx3) and 2 (idx2).
    const firstTwo = new Set(next.phase.order.slice(0, 2));
    expect(firstTwo).toEqual(new Set([1, 2]));
    const sortedAll = [...next.phase.order].sort((a, b) => a - b);
    expect(sortedAll).toEqual([0, 1, 2, 3]);
  });

  it("with exactly 3 live players both 'first-two' slots are the last two live, third is the remainder", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 3, cfg);
    const completedOrder = [2, 0, 1]; // last=1, second-to-last=0; remainder = 2
    const s: GameState = {
      ...s0,
      phase: { turn: 2, order: completedOrder, indexInOrder: 2 },
    };
    const next = advanceRound({ ...s, rngState: seed(3n) });
    expect(new Set(next.phase.order.slice(0, 2))).toEqual(new Set([0, 1]));
    expect(next.phase.order[2]).toBe(2);
  });
});

describe("turn-order rule (2P): iron-weighted first-player draw", () => {
  // Iron hexes within radius 5 of p0's base at origin; p1 far away with no iron in range.
  function twoPlayerState(seedN: bigint): GameState {
    const board = mkBoard();
    const ironHexes = [hex(1, -1, 0), hex(2, -2, 0), hex(3, -3, 0)];
    const present = new Set(board.hexes.map(key));
    for (const h of ironHexes) {
      if (!present.has(key(h))) {
        board.hexes.push(h);
        present.add(key(h));
      }
    }
    board.iron = ironHexes;
    const bases: Base[] = [
      { owner: 0, hex: hex(0, 0, 0), state: "fresh", order: 0 },
      { owner: 1, hex: hex(0, 8, -8), state: "fresh", order: 0 },
    ];
    return {
      board,
      bases,
      factories: [],
      players: [
        { id: 0, basesInHand: cfg.baseLimit - 1, alliance: [0], eliminated: false, victoryStreak: 0, allianceCooldownTurns: 0 },
        { id: 1, basesInHand: cfg.baseLimit - 1, alliance: [1], eliminated: false, victoryStreak: 0, allianceCooldownTurns: 0 },
      ],
      phase: { turn: 2, order: [0, 1], indexInOrder: 1 }, // completed turn 2
      factorySupply: cfg.factorySupply,
      config: cfg,
      rngState: seed(seedN),
    };
  }

  it("only one player controls iron => that player is always drawn first", () => {
    // p0 controls 3 iron, p1 controls 0; weight(p0)=3, weight(p1)=0 => p0 always first.
    for (const seedN of [0n, 1n, 2n, 3n, 7n, 50n, 123n]) {
      const s = twoPlayerState(seedN);
      const next = advanceRound(s);
      expect(next.phase.order).toEqual([0, 1]);
    }
  });

  it("statistically: higher-iron player goes first a strong majority of the time", () => {
    // p0 weight 3, p1 weight 0 here (deterministic 100%), but assert structurally
    // over many seeds that p0 leads.
    let p0First = 0;
    const trials = 60;
    for (let i = 0; i < trials; i++) {
      const s = twoPlayerState(BigInt(1000 + i));
      const next = advanceRound(s);
      if (next.phase.order[0] === 0) p0First++;
    }
    expect(p0First).toBeGreaterThan(trials / 2);
  });

  it("both players have zero iron => uniform fallback still yields a valid 2-permutation", () => {
    const board = mkBoard();
    // No iron anywhere in range.
    board.iron = [];
    const bases: Base[] = [
      { owner: 0, hex: hex(0, 0, 0), state: "fresh", order: 0 },
      { owner: 1, hex: hex(0, 8, -8), state: "fresh", order: 0 },
    ];
    const s: GameState = {
      board,
      bases,
      factories: [],
      players: [
        { id: 0, basesInHand: cfg.baseLimit - 1, alliance: [0], eliminated: false, victoryStreak: 0, allianceCooldownTurns: 0 },
        { id: 1, basesInHand: cfg.baseLimit - 1, alliance: [1], eliminated: false, victoryStreak: 0, allianceCooldownTurns: 0 },
      ],
      phase: { turn: 2, order: [0, 1], indexInOrder: 1 },
      factorySupply: cfg.factorySupply,
      config: cfg,
      rngState: seed(11n),
    };
    const next = advanceRound(s);
    expect([...next.phase.order].sort((a, b) => a - b)).toEqual([0, 1]);
  });
});

describe("determinism across a rollover", () => {
  it("same seed reproduces the same drawn order through advanceRound", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 4, cfg);
    const s: GameState = {
      ...s0,
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
      rngState: seed(321n),
    };
    const a = advanceRound(s);
    const b = advanceRound(s);
    expect(a.phase.order).toEqual(b.phase.order);
    expect(a.rngState).toEqual(b.rngState);
  });

  it("rng is threaded forward across a rollover (state advances)", () => {
    const board = mkBoard();
    const s0 = setupGame(seed(7n), board, 4, cfg);
    const s: GameState = {
      ...s0,
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
      rngState: seed(321n),
    };
    const next = advanceRound(s);
    expect(next.rngState).not.toEqual(seed(321n));
  });
});

describe("advanceRound — variant (b)/P2 victoryStreak update at turn rollover", () => {
  it("increments victoryStreak for players whose coalition meets threshold; resets others", () => {
    // P0 controls 10 iron via TEN_IRON; P1 controls 0 iron (far away).
    const cfg = defaultConfig();
    const s0 = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON, config: cfg });
    // Pre-rollover: streaks at 0.
    expect(s0.players[0]!.victoryStreak).toBe(0);
    expect(s0.players[1]!.victoryStreak).toBe(0);
    // Force the phase to one-before-rollover so a single advanceRound call rolls the turn.
    const s = { ...s0, phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 } } as GameState;
    const next = advanceRound(s);
    expect(next.phase.turn).toBe(s.phase.turn + 1); // rollover happened
    expect(next.players[0]!.victoryStreak).toBe(1);
    expect(next.players[1]!.victoryStreak).toBe(0);
  });

  it("resets victoryStreak to 0 when a player's coalition drops below threshold", () => {
    const cfg = defaultConfig();
    // Start with P0 not meeting threshold (only 1 iron) but with a non-zero streak from prior turns.
    const s0 = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: [hex(1, -1, 0), hex(30, -29, -1)], config: cfg });
    const s = {
      ...s0,
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
      players: s0.players.map((p) => (p.id === 0 ? { ...p, victoryStreak: 5 } : p)),
    } as GameState;
    const next = advanceRound(s);
    expect(next.phase.turn).toBe(s.phase.turn + 1);
    expect(next.players[0]!.victoryStreak).toBe(0);
  });

  it("does NOT update streaks on within-turn advances (no rollover)", () => {
    const cfg = defaultConfig();
    const s0 = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON, config: cfg });
    const s = { ...s0, phase: { ...s0.phase, indexInOrder: 0 } } as GameState;
    // indexInOrder is not yet at the last; advanceRound is a within-turn step.
    const next = advanceRound(s);
    expect(next.phase.turn).toBe(s.phase.turn); // no rollover
    expect(next.players[0]!.victoryStreak).toBe(0); // unchanged
  });
});

describe("advanceRound — alliance Phase 5: allianceCooldownTurns decrement at rollover", () => {
  it("decrements each non-eliminated player's cooldown by 1 (floor at 0) at the rollover", () => {
    const s0 = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(20, -20, 0)], iron: [hex(1, -1, 0), hex(20, -19, -1)] });
    const s = {
      ...s0,
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
      players: s0.players.map((p) => {
        if (p.id === 0) return { ...p, allianceCooldownTurns: 2 };
        if (p.id === 1) return { ...p, allianceCooldownTurns: 0 };
        return p;
      }),
    } as GameState;
    const next = advanceRound(s);
    expect(next.phase.turn).toBe(s.phase.turn + 1); // rollover happened
    expect(next.players[0]!.allianceCooldownTurns).toBe(1);
    expect(next.players[1]!.allianceCooldownTurns).toBe(0); // floor at 0
  });

  it("does NOT change cooldown on within-turn advances (no rollover)", () => {
    const s0 = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(20, -20, 0)], iron: [hex(1, -1, 0), hex(20, -19, -1)] });
    const s = {
      ...s0,
      phase: { ...s0.phase, indexInOrder: 0 },
      players: s0.players.map((p) => (p.id === 0 ? { ...p, allianceCooldownTurns: 3 } : p)),
    } as GameState;
    const next = advanceRound(s);
    expect(next.phase.turn).toBe(s.phase.turn); // no rollover
    expect(next.players[0]!.allianceCooldownTurns).toBe(3); // unchanged
  });

  it("does NOT change cooldown for eliminated players", () => {
    const s0 = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(20, -20, 0)], iron: [hex(1, -1, 0), hex(20, -19, -1)] });
    const s = {
      ...s0,
      phase: { ...s0.phase, indexInOrder: s0.phase.order.length - 1 },
      players: s0.players.map((p) => (p.id === 0 ? { ...p, allianceCooldownTurns: 2, eliminated: true } : p)),
    } as GameState;
    const next = advanceRound(s);
    expect(next.players[0]!.allianceCooldownTurns).toBe(2); // unchanged (eliminated)
  });
});
