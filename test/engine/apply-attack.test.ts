import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import type { Action, GameState } from "../../src/engine/types";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";

// On-board coordinates for the seed-1n/size-96 board (93-hex oval). All fixture
// hexes below were verified on-board. Attack semantics: spec §8.
//
// Standard win fixture: acting player p0 has 6 fresh bases all within attackRange
// (6) of the target (2,-2,0). Opponent p1 has 2 bases (<4 => radiating, every
// base attackable): the target base (2,-2,0) and a defender base (0,-1,1), both
// within range of the target.
const TARGET = hex(2, -2, 0);
const DEFENDER = hex(0, -1, 1);
const ATTACKERS6 = [
  hex(0, 0, 0),
  hex(-1, 1, 0),
  hex(0, 1, -1),
  hex(1, 0, -1),
  hex(0, 2, -2),
  hex(-2, 2, 0),
];

const winFixture = (): GameState =>
  mkState({
    board: 96,
    basesP0: ATTACKERS6,
    basesP1: [TARGET, DEFENDER],
  });

const attackAction = (attackers = ATTACKERS6): Action => ({
  kind: "attack",
  attacks: [{ target: TARGET, attackers, defender: DEFENDER }],
});

describe("applyAction — attack: win path (commit 6 auto-win)", () => {
  it("removes the opponent target base and places a fresh base for the acting player", () => {
    const s = winFixture();
    const inHandBefore = s.players[0]!.basesInHand;
    const { state } = applyAction(s, attackAction());

    // Opponent no longer owns any base at the target hex.
    const oppAtTarget = state.bases.find(
      (b) => b.owner === 1 && key(b.hex) === key(TARGET),
    );
    expect(oppAtTarget).toBeUndefined();

    // Acting player now owns a fresh base at the target hex.
    const mine = state.bases.find((b) => key(b.hex) === key(TARGET));
    expect(mine).toBeDefined();
    expect(mine!.owner).toBe(0);
    expect(mine!.state).toBe("fresh");

    // basesInHand decremented by 1 (placed the replacement).
    expect(state.players[0]!.basesInHand).toBe(inHandBefore - 1);
  });

  it("emits combat then baseReplaced events", () => {
    const s = winFixture();
    const { events } = applyAction(s, attackAction());
    expect(events).toEqual([
      { kind: "combat", target: TARGET, committed: 6, attackerWon: true },
      { kind: "baseReplaced", hex: TARGET, from: 1, to: 0 },
    ]);
  });

  it("fatigues all 6 committed attackers and the defender", () => {
    const s = winFixture();
    const { state } = applyAction(s, attackAction());

    for (const a of ATTACKERS6) {
      const b = state.bases.find((x) => x.owner === 0 && key(x.hex) === key(a))!;
      expect(b.state).toBe("fatigued");
    }
    const def = state.bases.find((x) => x.owner === 1 && key(x.hex) === key(DEFENDER))!;
    expect(def.state).toBe("fatigued");
  });

  it("replacement base has order greater than every pre-existing order", () => {
    const s = winFixture();
    const maxOrderBefore = Math.max(...s.bases.map((b) => b.order));
    const { state } = applyAction(s, attackAction());
    const mine = state.bases.find((b) => b.owner === 0 && key(b.hex) === key(TARGET))!;
    expect(mine.order).toBeGreaterThan(maxOrderBefore);
  });
});

describe("applyAction — attack: defender wins (combatTable forces loss)", () => {
  // combat draws from rngState for commit 3..5; force a deterministic loss by
  // setting the win probability for commit 3 to 0 so any draw loses.
  const losingConfig = () => {
    const c = defaultConfig();
    return { ...c, combatTable: { ...c.combatTable, 3: 0 } };
  };

  const lossFixture = (): GameState =>
    mkState({ board: 96, basesP0: ATTACKERS6, basesP1: [TARGET, DEFENDER], config: losingConfig() });

  it("only fatigue changes — no base swap, basesInHand unchanged", () => {
    const s = lossFixture();
    const inHandBefore = s.players[0]!.basesInHand;
    const attackers3 = ATTACKERS6.slice(0, 3);
    const action: Action = { kind: "attack", attacks: [{ target: TARGET, attackers: attackers3, defender: DEFENDER }] };
    const { state } = applyAction(s, action);

    // Opponent still owns the target base.
    const oppAtTarget = state.bases.find((b) => b.owner === 1 && key(b.hex) === key(TARGET));
    expect(oppAtTarget).toBeDefined();

    // No replacement placed.
    expect(state.players[0]!.basesInHand).toBe(inHandBefore);
    expect(state.bases).toHaveLength(s.bases.length);

    // The 3 committed attackers + defender are fatigued; the rest stay fresh.
    for (const a of attackers3) {
      expect(state.bases.find((b) => b.owner === 0 && key(b.hex) === key(a))!.state).toBe("fatigued");
    }
    expect(state.bases.find((b) => b.owner === 1 && key(b.hex) === key(DEFENDER))!.state).toBe("fatigued");
    for (const a of ATTACKERS6.slice(3)) {
      expect(state.bases.find((b) => b.owner === 0 && key(b.hex) === key(a))!.state).toBe("fresh");
    }
  });

  it("emits a single combat event with attackerWon:false", () => {
    const s = lossFixture();
    const attackers3 = ATTACKERS6.slice(0, 3);
    const action: Action = { kind: "attack", attacks: [{ target: TARGET, attackers: attackers3, defender: DEFENDER }] };
    const { events } = applyAction(s, action);
    expect(events).toEqual([{ kind: "combat", target: TARGET, committed: 3, attackerWon: false }]);
  });
});

describe("applyAction — attack: maxed-out (basesInHand 0)", () => {
  it("destroys the target base with no replacement and emits baseDestroyed", () => {
    const s = winFixture();
    s.players[0]!.basesInHand = 0; // acting player maxed out (12 on board)
    const basesBefore = s.bases.length;
    const { state, events } = applyAction(s, attackAction());

    // Target base removed entirely; nobody owns it now.
    const atTarget = state.bases.find((b) => key(b.hex) === key(TARGET));
    expect(atTarget).toBeUndefined();

    // Net one fewer base; no replacement placed.
    expect(state.bases).toHaveLength(basesBefore - 1);
    expect(state.players[0]!.basesInHand).toBe(0);

    expect(events).toEqual([
      { kind: "combat", target: TARGET, committed: 6, attackerWon: true },
      { kind: "baseDestroyed", hex: TARGET, owner: 1 },
    ]);
  });
});

describe("applyAction — attack: validation throws", () => {
  it("throws when fewer than 3 attackers", () => {
    const s = winFixture();
    expect(() => applyAction(s, attackAction(ATTACKERS6.slice(0, 2)))).toThrow();
  });

  it("throws when more than 6 attackers", () => {
    const s = mkState({ board: 96, basesP0: [...ATTACKERS6, hex(1, 1, -2)], basesP1: [TARGET, DEFENDER] });
    expect(() => applyAction(s, attackAction([...ATTACKERS6, hex(1, 1, -2)]))).toThrow();
  });

  it("throws when an attacker is not fresh", () => {
    const s = winFixture();
    // fatigue one of the attackers in the input fixture.
    const idx = s.bases.findIndex((b) => b.owner === 0 && key(b.hex) === key(ATTACKERS6[0]!));
    s.bases[idx] = { ...s.bases[idx]!, state: "fatigued" };
    expect(() => applyAction(s, attackAction())).toThrow();
  });

  it("throws when the target is an interior (non-hull-vertex) base of a perimetered opponent", () => {
    // Opponent p1 perimetered (5 bases, non-degenerate hull); (0,0,0) is interior.
    const opp = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2), hex(0, 0, 0)];
    const attackers3 = [hex(0, 4, -4), hex(-1, 4, -3), hex(0, 3, -3)];
    const s = mkState({ board: 96, basesP0: attackers3, basesP1: opp });
    const action: Action = {
      kind: "attack",
      attacks: [{ target: hex(0, 0, 0), attackers: attackers3, defender: hex(2, 0, -2) }],
    };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("allows attacking a hull VERTEX of a perimetered opponent", () => {
    const opp = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2), hex(0, 0, 0)];
    const attackers3 = [hex(0, 4, -4), hex(-1, 4, -3), hex(0, 3, -3)];
    const s = mkState({ board: 96, basesP0: attackers3, basesP1: opp });
    // target (2,0,-2) is a hull vertex; defender another opp base in range.
    const action: Action = {
      kind: "attack",
      attacks: [{ target: hex(2, 0, -2), attackers: attackers3, defender: hex(-2, 2, 0) }],
    };
    expect(() => applyAction(s, action)).not.toThrow();
  });

  it("throws when the defender is not owned by the target's owner", () => {
    // defender hex hosts an acting-player base, not the opponent's.
    const s = winFixture();
    const action: Action = {
      kind: "attack",
      attacks: [{ target: TARGET, attackers: ATTACKERS6.slice(0, 3), defender: hex(0, 0, 0) }],
    };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("throws when the defender base is not fresh", () => {
    const s = winFixture();
    const idx = s.bases.findIndex((b) => b.owner === 1 && key(b.hex) === key(DEFENDER));
    s.bases[idx] = { ...s.bases[idx]!, state: "fatigued" };
    expect(() => applyAction(s, attackAction())).toThrow();
  });

  it("throws when there is no opponent base at the target hex", () => {
    const s = winFixture();
    const action: Action = {
      kind: "attack",
      attacks: [{ target: hex(3, -3, 0), attackers: ATTACKERS6.slice(0, 3), defender: DEFENDER }],
    };
    expect(() => applyAction(s, action)).toThrow();
  });
});

describe("applyAction — attack: out-of-range attacker", () => {
  it("throws when an attacker is beyond attackRange of the target", () => {
    // attackRange default 6. Give p0 two fresh near bases plus one far base; set
    // attackRange to 2 via config so a d>2 attacker is out of range.
    const c = defaultConfig();
    const cfg = { ...c, attackRange: 2 };
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(-1, 1, 0), hex(0, 2, -2)],
      basesP1: [TARGET, DEFENDER],
      config: cfg,
    });
    // (0,2,-2) is distance 4 from target (2,-2,0) > attackRange 2 => throw.
    const action: Action = {
      kind: "attack",
      attacks: [{ target: TARGET, attackers: [hex(0, 0, 0), hex(-1, 1, 0), hex(0, 2, -2)], defender: DEFENDER }],
    };
    expect(() => applyAction(s, action)).toThrow();
  });
});

describe("applyAction — multi-attack", () => {
  it("throws when the second attack reuses a base fatigued by the first", () => {
    const s = winFixture();
    // First attack uses ATTACKERS6[0..2]; second reuses ATTACKERS6[0] (now fatigued).
    const action: Action = {
      kind: "attack",
      attacks: [
        { target: TARGET, attackers: ATTACKERS6.slice(0, 3), defender: DEFENDER },
        { target: TARGET, attackers: ATTACKERS6.slice(0, 3), defender: DEFENDER },
      ],
    };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("applies two attacks with disjoint fresh attacker sets", () => {
    // Two opponent targets, each with its own defender; p0 has 6 attackers split
    // into two disjoint triples. Use commit 3 + auto-win? commit 3 draws; instead
    // use 3 attackers each but rely on default combatTable (commit 3 p=0.75 — may
    // lose). To keep this deterministic and structural, assert it does not throw
    // and that both combat events are emitted regardless of outcome.
    const T2 = hex(0, 4, -4);
    const D2 = hex(-1, 4, -3);
    const s = mkState({
      board: 96,
      basesP0: ATTACKERS6,
      basesP1: [TARGET, DEFENDER],
      basesP2: [T2, D2],
    });
    const action: Action = {
      kind: "attack",
      attacks: [
        { target: TARGET, attackers: ATTACKERS6.slice(0, 3), defender: DEFENDER },
        { target: T2, attackers: ATTACKERS6.slice(3, 6), defender: D2 },
      ],
    };
    const { events } = applyAction(s, action);
    const combats = events.filter((e) => e.kind === "combat");
    expect(combats).toHaveLength(2);
    expect(combats[0]).toMatchObject({ kind: "combat", target: TARGET, committed: 3 });
    expect(combats[1]).toMatchObject({ kind: "combat", target: T2, committed: 3 });
  });

  it("threads PRNG so two independent combats consume the seeded sequence in order", () => {
    // With both attacks at commit 3 and default table, outcomes are deterministic
    // from seed 1n. We only assert structural threading: rngState advances.
    const T2 = hex(0, 4, -4);
    const D2 = hex(-1, 4, -3);
    const s = mkState({
      board: 96,
      basesP0: ATTACKERS6,
      basesP1: [TARGET, DEFENDER],
      basesP2: [T2, D2],
    });
    const action: Action = {
      kind: "attack",
      attacks: [
        { target: TARGET, attackers: ATTACKERS6.slice(0, 3), defender: DEFENDER },
        { target: T2, attackers: ATTACKERS6.slice(3, 6), defender: D2 },
      ],
    };
    const { state } = applyAction(s, action);
    expect(state.rngState).not.toEqual(s.rngState);
  });
});

describe("applyAction — attack: purity", () => {
  it("does not mutate the input state", () => {
    const s = winFixture();
    const basesBefore = s.bases.map((b) => ({ ...b }));
    const inHandBefore = s.players[0]!.basesInHand;
    const rngBefore = s.rngState;
    const { state } = applyAction(s, attackAction());

    // input bases unchanged (states + owners).
    expect(s.bases).toHaveLength(basesBefore.length);
    s.bases.forEach((b, i) => {
      expect(b.state).toBe(basesBefore[i]!.state);
      expect(b.owner).toBe(basesBefore[i]!.owner);
    });
    expect(s.players[0]!.basesInHand).toBe(inHandBefore);
    expect(s.rngState).toBe(rngBefore);

    // returned state is a new object with cloned arrays.
    expect(state).not.toBe(s);
    expect(state.bases).not.toBe(s.bases);
    expect(state.players).not.toBe(s.players);
  });
});
