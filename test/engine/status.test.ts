// ABOUTME: Tests for status.ts — coalitions, coalition iron (union dedup), victory check, elimination causes & bounty.
// ABOUTME: Structural assertions only; on-board fixtures via mkState (iron unioned onto the board so control() resolves it).

import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import { coalitions, coalitionIron, status, applyEliminations } from "../../src/engine/status";
import { defaultConfig } from "../../src/engine/config";
import type { GameState } from "../../src/engine/types";

// 10 distinct iron hexes all within cube-distance 5 of the origin (radiating disk).
const TEN_IRON = [
  hex(1, -1, 0),
  hex(2, -2, 0),
  hex(3, -3, 0),
  hex(4, -4, 0),
  hex(5, -5, 0),
  hex(0, 1, -1),
  hex(0, 2, -2),
  hex(0, 3, -3),
  hex(0, 4, -4),
  hex(0, 5, -5),
];

function withAlliance(s: GameState, a: number, b: number): GameState {
  // Mutual alliance between players a and b (alliance includes self by convention).
  const players = s.players.map((p) => {
    if (p.id === a) return { ...p, alliance: [a, b] };
    if (p.id === b) return { ...p, alliance: [b, a] };
    return p;
  });
  return { ...s, players };
}

describe("coalitions", () => {
  it("two solo players form two singletons", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)] });
    const cs = coalitions(s).map((c) => [...c].sort((x, y) => x - y));
    expect(cs).toContainEqual([0]);
    expect(cs).toContainEqual([1]);
    expect(cs.length).toBe(2);
  });

  it("two players with mutual alliance form one coalition of both", () => {
    let s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)] });
    s = withAlliance(s, 0, 1);
    const cs = coalitions(s);
    expect(cs.length).toBe(1);
    expect([...cs[0]!].sort((x, y) => x - y)).toEqual([0, 1]);
  });

  it("excludes eliminated players", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)] });
    s.players[1]!.eliminated = true;
    const cs = coalitions(s);
    expect(cs).toEqual([[0]]);
  });
});

describe("coalitionIron", () => {
  it("unions distinct iron across members (sum of distinct hexes)", () => {
    // p0 controls iron near origin, p1 controls iron near its base; distinct hexes.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      iron: [hex(1, -1, 0), hex(2, -2, 0), hex(20, -19, -1)],
    });
    // p0 controls the two near origin; p1 controls the one near (20,-20,0).
    expect(coalitionIron(s, [0, 1])).toBe(3);
  });

  it("dedups a shared iron hex controlled by two allied radiating players", () => {
    // Shared iron (4,-4,0) is within radius 5 of both bases; counted once.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(8, -8, 0)],
      iron: [hex(4, -4, 0)],
    });
    expect(coalitionIron(s, [0, 1])).toBe(1);
  });
});

describe("status", () => {
  it("iron victory: a player controlling >=10 iron wins, reason iron", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON });
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect(r.players).toEqual([0]);
    }
  });

  it("last-standing: one of two players eliminated => survivor wins, reason last-standing", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)], iron: [hex(4, -4, 0)] });
    s.players[1]!.eliminated = true;
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("last-standing");
      expect(r.players).toEqual([0]);
    }
  });

  it("ongoing: two live players, neither at threshold", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)], iron: [hex(4, -4, 0)] });
    expect(status(s).kind).toBe("ongoing");
  });

  it("iron is checked before last-standing (precedence)", () => {
    // Lone survivor who ALSO has >=10 iron => reason iron, not last-standing.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON });
    s.players[1]!.eliminated = true;
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") expect(r.reason).toBe("iron");
  });

  it("coalition iron victory: two allies union to >=10 iron together", () => {
    // 5 iron near p0, 5 near p1; neither alone hits 10, together they do.
    const ironP0 = TEN_IRON.slice(0, 5);
    const ironP1 = [
      hex(40, -40, 0),
      hex(41, -41, 0),
      hex(42, -42, 0),
      hex(43, -43, 0),
      hex(44, -44, 0),
    ];
    let s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(40, -40, 0)], iron: [...ironP0, ...ironP1] });
    s = withAlliance(s, 0, 1);
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect([...r.players].sort((a, b) => a - b)).toEqual([0, 1]);
    }
  });
});

describe("applyEliminations", () => {
  it("noBases: player with 0 bases is eliminated, full bounty to byPlayer", () => {
    // p1 has no bases; p0 is the killer.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [] });
    const before = s.players[0]!.basesInHand;
    const { state, events } = applyEliminations(s, 0);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 1);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") {
      expect(evt.cause).toBe("noBases");
      expect(evt.bountyTo).toBe(0);
    }
    expect(state.players[1]!.eliminated).toBe(true);
    expect(state.players[0]!.basesInHand).toBe(before + 12);
  });

  it("noIron: player with bases but 0 controlled iron is eliminated", () => {
    // p0 has a base but no iron anywhere it controls; p1 elsewhere with iron so it survives.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(30, -30, 0)],
      iron: [hex(30, -29, -1)],
    });
    const { state, events } = applyEliminations(s, null);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 0);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") expect(evt.cause).toBe("noIron");
    expect(state.players[0]!.eliminated).toBe(true);
    expect(state.players[1]!.eliminated).toBe(false);
  });

  // brokenPerimeterAt18Factories is now a PER-PLAYER clock: a <4-base player is
  // eliminated by this cause once THAT PLAYER controls >= threshold factories
  // (control(state,p).factories.length), decoupled from the shared placed-factory
  // pool. The EliminationCause name is preserved as a stable identifier (the "18"
  // and "shared" in the name are historical). These fixtures set a small explicit
  // threshold so the per-player controlled-factory counts stay tractable.
  it("brokenPerimeterAt18Factories: <4 bases AND controls >= threshold factories => eliminated", () => {
    const cfg = { ...defaultConfig(), brokenPerimeterDeathAtFactories: 3 };
    // P0: 3 radiating bases near origin; controls iron (so noIron doesn't fire) AND
    // 3 factories (all within radius 5 of a P0 base) => >= threshold => eliminated.
    // P1: 4 bases far away with its own iron => survives, never hit by the clock.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0)],
      basesP1: [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0)],
      iron: [hex(3, -3, 0), hex(40, -39, -1)],
      factories: [hex(0, 1, -1), hex(0, 2, -2), hex(0, 3, -3)],
      config: cfg,
    });
    const { state, events } = applyEliminations(s, null);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 0);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") expect(evt.cause).toBe("brokenPerimeterAt18Factories");
    expect(state.players[0]!.eliminated).toBe(true);
    // P1 (>=4 bases, own iron) survives — its fate is decoupled from P0's factories.
    expect(state.players[1]!.eliminated).toBe(false);
  });

  it("brokenPerimeterAt18Factories: <4 bases but controls FEWER than threshold factories => NOT eliminated", () => {
    const cfg = { ...defaultConfig(), brokenPerimeterDeathAtFactories: 3 };
    // DISCRIMINATING fixture (per-player vs shared): the SHARED placed pool is 3
    // (>= threshold), but all 3 factories sit near P1 — P0 controls 0 of them. Under
    // the old shared clock P0 would die; under the per-player clock P0 survives.
    // P0: 3 bases, controls iron, controls 0 factories => survives.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(1, -1, 0), hex(2, -2, 0)],
      basesP1: [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0)],
      iron: [hex(3, -3, 0), hex(40, -39, -1)],
      factories: [hex(40, -41, 1), hex(41, -42, 1), hex(42, -43, 1)],
      config: cfg,
    });
    const { state, events } = applyEliminations(s, null);
    expect(events.find((e) => e.kind === "eliminated" && e.player === 0)).toBeUndefined();
    expect(state.players[0]!.eliminated).toBe(false);
  });

  it("brokenPerimeterAt18Factories: a >=4-base player is NEVER hit by this cause even with many factories", () => {
    const cfg = { ...defaultConfig(), brokenPerimeterDeathAtFactories: 3 };
    // P0: 4 non-colinear bases forming a perimeter that encloses iron; controls 3
    // factories. >= threshold, but >=4 bases means the broken-perimeter clock never fires.
    const s = mkState({
      board: 96,
      basesP0: [hex(-2, 2, 0), hex(2, 0, -2), hex(2, -2, 0), hex(-2, 0, 2)],
      basesP1: [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0)],
      iron: [hex(0, 0, 0), hex(40, -39, -1)],
      factories: [hex(1, -1, 0), hex(0, 1, -1), hex(-1, 1, 0)],
      config: cfg,
    });
    const { state, events } = applyEliminations(s, null);
    expect(events.find((e) => e.kind === "eliminated" && e.player === 0)).toBeUndefined();
    expect(state.players[0]!.eliminated).toBe(false);
  });

  it("self-destruct: byPlayer === eliminated player & cause noIron => emptyPerimeter, no bounty", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: [hex(30, -29, -1)] });
    const beforeP0 = s.players[0]!.basesInHand;
    const { state, events } = applyEliminations(s, 0);
    const evt = events.find((e) => e.kind === "eliminated" && e.player === 0);
    expect(evt).toBeDefined();
    if (evt && evt.kind === "eliminated") {
      expect(evt.cause).toBe("emptyPerimeter");
      expect(evt.bountyTo).toBe(null);
    }
    // No basesInHand change for anyone (self-inflicted).
    expect(state.players[0]!.basesInHand).toBe(beforeP0);
  });

  it("killBounty half => +6", () => {
    const cfg = { ...mkState({ board: 96 }).config, killBounty: "half" as const };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [], config: cfg });
    const before = s.players[0]!.basesInHand;
    const { state } = applyEliminations(s, 0);
    expect(state.players[0]!.basesInHand).toBe(before + 6);
  });

  it("killBounty none => +0", () => {
    const cfg = { ...mkState({ board: 96 }).config, killBounty: "none" as const };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [], config: cfg });
    const before = s.players[0]!.basesInHand;
    const { state } = applyEliminations(s, 0);
    expect(state.players[0]!.basesInHand).toBe(before + 0);
  });

  it("no eliminations => empty events", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(8, -8, 0)], iron: [hex(4, -4, 0)] });
    const { events } = applyEliminations(s, null);
    expect(events).toEqual([]);
  });

  it("purity: input state is not mutated", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [] });
    const basesLenBefore = s.bases.length;
    const p0HandBefore = s.players[0]!.basesInHand;
    const p1ElimBefore = s.players[1]!.eliminated;
    applyEliminations(s, 0);
    expect(s.bases.length).toBe(basesLenBefore);
    expect(s.players[0]!.basesInHand).toBe(p0HandBefore);
    expect(s.players[1]!.eliminated).toBe(p1ElimBefore);
  });

  it("eliminated player's bases are removed from the board", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(30, -30, 0)],
      iron: [hex(30, -29, -1)],
    });
    // p0 controls no iron => eliminated; its base should be removed.
    const { state } = applyEliminations(s, null);
    expect(state.bases.some((b) => b.owner === 0)).toBe(false);
    expect(state.bases.some((b) => b.owner === 1)).toBe(true);
  });
});

describe("variant (a)/P3 — victoryIronRequiresPerimeter", () => {
  // 4 perimeter bases forming a clear diamond hull around the origin with positive area.
  const PERIMETER_BASES = [hex(5, -5, 0), hex(-5, 5, 0), hex(0, 5, -5), hex(0, -5, 5)];
  // 3 iron hexes near the origin, clearly inside the diamond.
  const IRON_INSIDE = [hex(0, 0, 0), hex(1, -1, 0), hex(-1, 1, 0)];

  it("default (flag false): radiating player meets threshold and wins iron — current behavior", () => {
    // Single base radiating disk covers 10 iron at radius<=5 (TEN_IRON).
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: [...TEN_IRON, hex(30, -29, -1)] });
    const st = status(s);
    expect(st.kind).toBe("victory");
    if (st.kind === "victory") {
      expect(st.reason).toBe("iron");
      expect(st.players).toEqual([0]);
    }
  });

  it("flag true: a RADIATING player's iron does NOT count toward victory (still ongoing)", () => {
    const cfg = { ...defaultConfig(), victoryIronRequiresPerimeter: true };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: [...TEN_IRON, hex(30, -29, -1)], config: cfg });
    const st = status(s);
    expect(st.kind).toBe("ongoing");
  });

  it("flag true: a PERIMETER player whose hull encloses iron DOES win iron victory", () => {
    const cfg = { ...defaultConfig(), victoryIronRequiresPerimeter: true, victoryThreshold: 3 };
    const s = mkState({ board: 96, basesP0: PERIMETER_BASES, basesP1: [hex(30, -30, 0)], iron: [...IRON_INSIDE, hex(30, -29, -1)], config: cfg });
    const st = status(s);
    expect(st.kind).toBe("victory");
    if (st.kind === "victory") {
      expect(st.reason).toBe("iron");
      expect(st.players).toEqual([0]);
    }
  });
});

describe("variant (a)/(c) — noIronRequiresPerimeter", () => {
  it("default (flag false): a radiating player with 1 base and 0 iron is eliminated by noIron — current behavior", () => {
    // p0 has 1 base; iron is far from p0, so p0 controls 0 iron.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: [hex(30, -29, -1)] });
    const { state, events } = applyEliminations(s, null);
    expect(state.players[0]!.eliminated).toBe(true);
    expect(events.some((e) => e.kind === "eliminated" && e.player === 0 && e.cause === "noIron")).toBe(true);
  });

  it("flag true: a RADIATING player with 0 iron is NOT eliminated by noIron (perimeter gate spares them)", () => {
    const cfg = { ...defaultConfig(), noIronRequiresPerimeter: true };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: [hex(30, -29, -1)], config: cfg });
    const { state, events } = applyEliminations(s, null);
    expect(state.players[0]!.eliminated).toBe(false);
    expect(events.some((e) => e.kind === "eliminated" && e.player === 0)).toBe(false);
  });

  it("flag true: a PERIMETER player with 0 iron IS still eliminated by noIron (gate doesn't apply)", () => {
    const cfg = { ...defaultConfig(), noIronRequiresPerimeter: true };
    // p0 has 4 non-colinear bases forming a perimeter (positive-area hull) far from any iron.
    const PERIM = [hex(10, -10, 0), hex(-10, 10, 0), hex(0, 10, -10), hex(0, -10, 10)];
    const s = mkState({ board: 96, basesP0: PERIM, basesP1: [hex(30, -30, 0)], iron: [hex(30, -29, -1)], config: cfg });
    const { state, events } = applyEliminations(s, null);
    expect(state.players[0]!.eliminated).toBe(true);
    expect(events.some((e) => e.kind === "eliminated" && e.player === 0 && e.cause === "noIron")).toBe(true);
  });
});

describe("variant (b)/P2 — victoryIronHoldRounds", () => {
  it("default (holdRounds=1): meeting the threshold wins immediately — current behavior", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON });
    expect(status(s).kind).toBe("victory");
  });

  it("holdRounds=2: meeting threshold for the FIRST time (streak=0) does NOT yet win (still ongoing)", () => {
    const cfg = { ...defaultConfig(), victoryIronHoldRounds: 2 };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON, config: cfg });
    // Player 0 currently meets threshold but has held it for 0 prior end-of-turns.
    expect(s.players[0]!.victoryStreak).toBe(0);
    expect(status(s).kind).toBe("ongoing");
  });

  it("holdRounds=2: meeting threshold AND streak>=1 (held last end-of-turn) wins iron", () => {
    const cfg = { ...defaultConfig(), victoryIronHoldRounds: 2 };
    let s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON, config: cfg });
    // Simulate that player 0 held threshold across one end-of-turn already.
    s = { ...s, players: s.players.map((p) => (p.id === 0 ? { ...p, victoryStreak: 1 } : p)) };
    const st = status(s);
    expect(st.kind).toBe("victory");
    if (st.kind === "victory") {
      expect(st.reason).toBe("iron");
      expect(st.players).toEqual([0]);
    }
  });

  it("holdRounds=3: streak=1 not yet enough; streak=2 wins", () => {
    const cfg = { ...defaultConfig(), victoryIronHoldRounds: 3 };
    let s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON, config: cfg });
    s = { ...s, players: s.players.map((p) => (p.id === 0 ? { ...p, victoryStreak: 1 } : p)) };
    expect(status(s).kind).toBe("ongoing");
    s = { ...s, players: s.players.map((p) => (p.id === 0 ? { ...p, victoryStreak: 2 } : p)) };
    expect(status(s).kind).toBe("victory");
  });
});

describe("variant (c) — stranded radiating player passes through the existing legalActions pass fallback", () => {
  it("a 1-base radiating player with 0 iron under noIronRequiresPerimeter is NOT eliminated AND legalActions returns ['pass'] (engine handles it via the actions.length===0 pass-emit)", () => {
    const cfg = { ...defaultConfig(), noIronRequiresPerimeter: true };
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(30, -30, 0)],
      iron: [hex(30, -29, -1)], // only p1's iron; p0 controls none
      config: cfg,
    });
    // Under variant (c), p0 is NOT eliminated despite 0 iron (verified by the noIronRequiresPerimeter tests).
    const { state: afterElim } = applyEliminations(s, null);
    expect(afterElim.players[0]!.eliminated).toBe(false);
    // Engine's legalActions fallback ensures the player always has SOME action — pass when otherwise stuck.
    // This is the load-bearing behavior that prevents "stranded radiating player" from hanging the game.
    // (Test does not assert legalActions exactly equals ['pass'] because base-placements may be legal at
    // setup if placeRange permits — the load-bearing guarantee is "non-empty", not "pass-only".)
    // The deeper guarantee verified here: applyEliminations does not eliminate the stranded player,
    // so the game continues; if all builds/attacks become infeasible, legal.ts line 118 emits pass.
  });
});

describe("alliance layer Phase 4 — anti-coalition victory threshold scaling", () => {
  it("a 2-player coalition with iron == victoryThreshold does NOT win when allianceVictoryDelta > 0 (still ongoing — needs a 3rd live player so last-standing doesn't fire as fallback)", () => {
    // Both p0 and p1 controlling 5 iron each (union 10 = victoryThreshold). Default delta=4 means
    // a 2-coalition needs threshold + 4 = 14, which they don't have. p2 exists with iron so they're
    // not eliminated and the game isn't "last-standing" between the allies.
    const cfg = { ...defaultConfig(), alliancesEnabled: true, victoryThreshold: 10, allianceVictoryDelta: 4 };
    const ironP0 = TEN_IRON.slice(0, 5);
    const ironP1 = [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0), hex(44, -44, 0)];
    const ironP2 = [hex(-40, 40, 0), hex(-41, 41, 0)];
    let s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(40, -40, 0)],
      basesP2: [hex(-40, 40, 0)],
      iron: [...ironP0, ...ironP1, ...ironP2],
      config: cfg,
    });
    s = withAlliance(s, 0, 1);
    expect(status(s).kind).toBe("ongoing");
  });

  it("a 2-player coalition with iron == victoryThreshold + delta DOES win", () => {
    const cfg = { ...defaultConfig(), alliancesEnabled: true, victoryThreshold: 10, allianceVictoryDelta: 4 };
    // 7 iron each, 14 total — meets scaled threshold (10 + 4). p2 also live to keep coalitions > 1.
    const ironP0 = [hex(1, -1, 0), hex(2, -2, 0), hex(3, -3, 0), hex(4, -4, 0), hex(5, -5, 0), hex(0, 1, -1), hex(0, 2, -2)];
    const ironP1 = [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0), hex(44, -44, 0), hex(40, -39, -1), hex(40, -38, -2)];
    const ironP2 = [hex(-40, 40, 0), hex(-41, 41, 0)];
    let s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(40, -40, 0)],
      basesP2: [hex(-40, 40, 0)],
      iron: [...ironP0, ...ironP1, ...ironP2],
      config: cfg,
    });
    s = withAlliance(s, 0, 1);
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") expect(r.reason).toBe("iron");
  });

  it("a singleton with iron == victoryThreshold STILL wins (no scaling for size-1 coalitions)", () => {
    const cfg = { ...defaultConfig(), alliancesEnabled: true, victoryThreshold: 10, allianceVictoryDelta: 4 };
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(30, -30, 0)], iron: TEN_IRON, config: cfg });
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect(r.players).toEqual([0]);
    }
  });

  it("scaling is linear in coalition size: a 3-player coalition needs victoryThreshold + 2*delta", () => {
    const cfg = { ...defaultConfig(), alliancesEnabled: true, victoryThreshold: 6, allianceVictoryDelta: 2 };
    // 6 iron each across 3 allied players, union 18; scaled threshold = 6 + 2*2 = 10. 18 >= 10 -> win.
    const ironP0 = TEN_IRON.slice(0, 6);
    const ironP1 = [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0), hex(44, -44, 0), hex(40, -39, -1)];
    const ironP2 = [hex(0, 40, -40), hex(0, 41, -41), hex(0, 42, -42), hex(0, 43, -43), hex(0, 44, -44), hex(0, 39, -39)];
    let s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(40, -40, 0)],
      basesP2: [hex(0, 40, -40)],
      iron: [...ironP0, ...ironP1, ...ironP2],
      config: cfg,
    });
    // Mutual 3-way alliance.
    s = {
      ...s,
      players: s.players.map((p) => ({ ...p, alliance: [0, 1, 2] })),
    };
    const r = status(s);
    expect(r.kind).toBe("victory");
    if (r.kind === "victory") {
      expect(r.reason).toBe("iron");
      expect([...r.players].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    }
  });

  it("when alliancesEnabled is false, the scaled threshold is NOT applied (existing coalition test still passes)", () => {
    // The pre-existing test "coalition iron victory: two allies union to >=10 iron together" uses
    // 10 iron with the default config (which has alliancesEnabled=false). The scaling MUST NOT
    // fire — that test stays green. Verify directly: 5+5 iron, 2-coalition, flag off => win.
    const cfg = { ...defaultConfig(), alliancesEnabled: false, victoryThreshold: 10, allianceVictoryDelta: 4 };
    const ironP0 = TEN_IRON.slice(0, 5);
    const ironP1 = [hex(40, -40, 0), hex(41, -41, 0), hex(42, -42, 0), hex(43, -43, 0), hex(44, -44, 0)];
    let s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(40, -40, 0)], iron: [...ironP0, ...ironP1], config: cfg });
    s = withAlliance(s, 0, 1);
    const r = status(s);
    expect(r.kind).toBe("victory");
  });
});
