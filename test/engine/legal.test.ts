// ABOUTME: Tests for legalActions move generation (Task 5.7) — build/attack/pass enumeration.
// ABOUTME: The load-bearing test: every generated action is accepted by applyAction without throwing.

import { describe, it, expect } from "vitest";
import { hex, key, distance } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import type { Action, GameState } from "../../src/engine/types";
import { applyAction } from "../../src/engine/apply";
import { isLegalBasePlacement } from "../../src/engine/build";
import { legalActions } from "../../src/engine/legal";
import { mkState } from "../helpers/state";

// On-board coordinates for the seed-1n/size-96 board (93-hex oval), verified
// on-board by the apply-attack fixtures. p0 has 6 fresh bases all within
// attackRange (6) of the target (2,-2,0); opponent p1 has 2 bases (<4 =>
// radiating, every base attackable): the target (2,-2,0) and a defender (0,-1,1).
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

// Distances of each attacker to TARGET (2,-2,0):
//   (0,0,0)=2  (1,0,-1)=2  (-1,1,0)=3  (0,1,-1)=3  (0,2,-2)=4  (-2,2,0)=4
// Nearest 3 (distance asc, tie by ascending key): (0,0,0), (1,0,-1), (-1,1,0).

const attackFixture = (): GameState =>
  mkState({ board: 96, basesP0: ATTACKERS6, basesP1: [TARGET, DEFENDER] });

describe("legalActions — self-consistency (load-bearing)", () => {
  it("every returned action is accepted by applyAction without throwing", () => {
    // A representative mid-game fixture: p0 can build (controls iron) AND attack
    // (>=3 fresh bases in range of p1's radiating target).
    const s = mkState({
      board: 96,
      basesP0: ATTACKERS6,
      basesP1: [TARGET, DEFENDER],
      iron: [hex(0, 0, 0)],
    });
    const actions = legalActions(s);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(() => applyAction(s, a)).not.toThrow();
    }
  });

  it("emits no base-build action and every action applies for a maxed-out player (basesInHand 0)", () => {
    // A late-game maxed-out player: all bases on board (basesInHand 0) but with
    // buildBudget >= 1 (controls iron) and at least one geometrically-legal base
    // hex inside its own perimeter. legalActions must NOT emit a base build it
    // cannot apply (you cannot place a base you don't have); factory builds may
    // still appear if factorySupply > 0 and within range.
    const perimeterBases = [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)];
    const s = mkState({
      board: 96,
      basesP0: perimeterBases,
      iron: [hex(2, -2, 0), hex(2, 0, -2)], // rc=2 => buildBudget 1
    });
    s.players[0]!.basesInHand = 0;
    // Sanity: there IS a geometrically-legal interior base hex when bases remain.
    const withBases = mkState({ board: 96, basesP0: perimeterBases });
    expect(isLegalBasePlacement(withBases, 0, hex(0, 2, -2))).toBe(true);

    const actions = legalActions(s);
    expect(actions.length).toBeGreaterThan(0);
    // (a) NO base-build action is emitted for the maxed-out player.
    const baseBuilds = actions.filter(
      (a) => a.kind === "build" && a.pieces.some((p) => p.type === "base"),
    );
    expect(baseBuilds).toHaveLength(0);
    // (b) EVERY emitted action is accepted by applyAction without throwing.
    for (const a of actions) {
      expect(() => applyAction(s, a)).not.toThrow();
    }
  });

  it("every action is accepted for a build-only fixture (player with iron, no attack)", () => {
    // p0 controls iron but has no opponent in range to attack.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(0, 0, 0)],
    });
    const actions = legalActions(s);
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(() => applyAction(s, a)).not.toThrow();
    }
  });
});

describe("legalActions — build enumeration", () => {
  it("emits single-piece build actions when budget >= 1", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(0, 0, 0)],
    });
    const builds = legalActions(s).filter((a) => a.kind === "build");
    expect(builds.length).toBeGreaterThan(0);
    // Each build action carries exactly one piece (single-piece building block).
    for (const b of builds) {
      expect(b.kind).toBe("build");
      if (b.kind === "build") expect(b.pieces).toHaveLength(1);
    }
  });

  it("emits no build actions when budget is 0", () => {
    // p0 controls no iron and no factories => resourceCount 0, not bootstrap
    // (bootstrap needs >=1 controlled iron). Budget 0. Iron at (6,-6,0) is
    // distance 6 from the base at origin — beyond control radius 5, so NOT
    // controlled (an on-board hex; (5,-5,0) would be d5 == radius, controlled).
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(6, -6, 0)], // far away (d6 > radius 5), not controlled
    });
    const builds = legalActions(s).filter((a) => a.kind === "build");
    expect(builds).toHaveLength(0);
  });

  it("every emitted build piece is a legal placement (accepted by applyAction)", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(0, 0, 0)],
    });
    const builds = legalActions(s).filter((a) => a.kind === "build");
    for (const b of builds) {
      expect(() => applyAction(s, b)).not.toThrow();
    }
  });
});

describe("legalActions — attack enumeration", () => {
  it("emits attacks for commitment levels 3..min(6,eligible) against a radiating opponent base", () => {
    const s = attackFixture();
    const attacks = legalActions(s).filter((a) => a.kind === "attack");
    expect(attacks.length).toBeGreaterThan(0);

    // p0 has 6 eligible attackers in range of TARGET => commitment levels 3,4,5,6.
    const levelsForTarget = attacks
      .filter((a) => a.kind === "attack" && a.attacks.length === 1)
      .filter(
        (a) => a.kind === "attack" && key(a.attacks[0]!.target) === key(TARGET),
      )
      .map((a) => (a.kind === "attack" ? a.attacks[0]!.attackers.length : 0))
      .sort((x, y) => x - y);
    expect(levelsForTarget).toEqual([3, 4, 5, 6]);
  });

  it("each attack is a single AttackDecl whose attackers length equals its commitment level and are all in range", () => {
    const s = attackFixture();
    const range = s.config.attackRange;
    const attacks = legalActions(s).filter((a) => a.kind === "attack");
    for (const a of attacks) {
      if (a.kind !== "attack") continue;
      expect(a.attacks).toHaveLength(1);
      const decl = a.attacks[0]!;
      expect(decl.attackers.length).toBeGreaterThanOrEqual(3);
      expect(decl.attackers.length).toBeLessThanOrEqual(6);
      for (const at of decl.attackers) {
        expect(distance(at, decl.target)).toBeLessThanOrEqual(range);
      }
      expect(distance(decl.defender, decl.target)).toBeLessThanOrEqual(range);
    }
  });

  it("the commitment-3 attacker subset is the 3 nearest (distance asc, tie by key)", () => {
    const s = attackFixture();
    const attacks = legalActions(s).filter((a) => a.kind === "attack");
    const lvl3 = attacks.find(
      (a) =>
        a.kind === "attack" &&
        a.attacks.length === 1 &&
        key(a.attacks[0]!.target) === key(TARGET) &&
        a.attacks[0]!.attackers.length === 3,
    );
    expect(lvl3).toBeDefined();
    if (lvl3 && lvl3.kind === "attack") {
      const got = lvl3.attacks[0]!.attackers.map(key).sort();
      // Nearest 3 to (2,-2,0): (0,0,0) d2, (1,0,-1) d2, (-1,1,0) d3.
      const want = [hex(0, 0, 0), hex(1, 0, -1), hex(-1, 1, 0)].map(key).sort();
      expect(got).toEqual(want);
    }
  });

  it("the chosen defender is an opponent base distinct from the target", () => {
    const s = attackFixture();
    const attacks = legalActions(s).filter((a) => a.kind === "attack");
    for (const a of attacks) {
      if (a.kind !== "attack") continue;
      const decl = a.attacks[0]!;
      expect(key(decl.defender)).not.toBe(key(decl.target));
    }
  });
});

describe("legalActions — no valid attack target", () => {
  it("emits no attacks when the opponent is out of attackRange", () => {
    // p0 bases far from p1's bases (distance > attackRange 6).
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(-1, 1, 0), hex(0, 1, -1)],
      basesP1: [hex(7, -7, 0)],
    });
    const attacks = legalActions(s).filter((a) => a.kind === "attack");
    expect(attacks).toHaveLength(0);
  });

  it("emits no attacks against an interior (non-hull-vertex) base of a perimetered opponent", () => {
    // Opponent p1 perimetered (5 bases, non-degenerate hull); (0,0,0) is interior.
    // p0 has 3 fresh bases in range of (0,0,0), but it is not a hull vertex => no attack.
    const opp = [hex(2, -2, 0), hex(-2, 2, 0), hex(2, 0, -2), hex(-2, 0, 2), hex(0, 0, 0)];
    const attackers3 = [hex(0, 4, -4), hex(-1, 4, -3), hex(0, 3, -3)];
    const s = mkState({ board: 96, basesP0: attackers3, basesP1: opp });
    const attacks = legalActions(s).filter((a) => a.kind === "attack");
    // No attack should target the interior base (0,0,0).
    for (const a of attacks) {
      if (a.kind !== "attack") continue;
      expect(key(a.attacks[0]!.target)).not.toBe(key(hex(0, 0, 0)));
    }
  });

  it("emits no attacks when the player has fewer than 3 fresh bases in range", () => {
    // Only 2 attackers in range of the radiating opponent target.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(-1, 1, 0)],
      basesP1: [TARGET, DEFENDER],
    });
    const attacks = legalActions(s).filter((a) => a.kind === "attack");
    expect(attacks).toHaveLength(0);
  });
});

describe("legalActions — pass", () => {
  it("does NOT include pass when allowPass is false and a build/attack is available", () => {
    const s = mkState({
      board: 96,
      basesP0: ATTACKERS6,
      basesP1: [TARGET, DEFENDER],
      iron: [hex(0, 0, 0)],
    });
    expect(s.config.allowPass).toBe(false);
    const actions = legalActions(s);
    expect(actions.some((a) => a.kind === "pass")).toBe(false);
    // sanity: there IS at least one build or attack.
    expect(actions.some((a) => a.kind === "build" || a.kind === "attack")).toBe(true);
  });

  it("returns exactly pass for a stuck player (no build budget, no attack)", () => {
    // p0 controls no iron (budget 0) and no opponent in range (no attack).
    // Iron at (6,-6,0) is distance 6 > control radius 5 => not controlled.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(6, -6, 0)], // not controlled (d6 > radius 5)
    });
    const actions = legalActions(s);
    expect(actions).toEqual([{ kind: "pass" }]);
  });

  it("includes pass when allowPass is true even with other actions available", () => {
    const cfg = { ...defaultConfig(), allowPass: true };
    const s = mkState({
      board: 96,
      basesP0: ATTACKERS6,
      basesP1: [TARGET, DEFENDER],
      iron: [hex(0, 0, 0)],
      config: cfg,
    });
    const actions = legalActions(s);
    expect(actions.some((a) => a.kind === "pass")).toBe(true);
    // And the pass action itself applies cleanly.
    const pass = actions.find((a) => a.kind === "pass")!;
    expect(() => applyAction(s, pass)).not.toThrow();
  });
});

describe("alliance layer Phase 2 — `ally` action legality", () => {
  // Build a baseline 3-player state at setup; alliances disabled by default.
  function mk(alliancesEnabled = false): GameState {
    const cfg = { ...defaultConfig(), alliancesEnabled };
    return mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      basesP2: [hex(0, 20, -20)],
      iron: [hex(1, -1, 0), hex(20, -19, -1), hex(0, 19, -19)],
      config: cfg,
    });
  }

  it("does NOT emit ally actions when alliancesEnabled is false (default)", () => {
    const acts = legalActions(mk(false));
    expect(acts.some((a) => a.kind === "ally")).toBe(false);
  });

  it("emits one ally action per non-self live player when alliancesEnabled and basesInHand >= 1", () => {
    const s = mk(true);
    const acts = legalActions(s);
    const allies = acts.filter((a) => a.kind === "ally") as Extract<Action, { kind: "ally" }>[];
    // currentPlayer is 0; targets should be 1 and 2 (not self, both live).
    expect(allies.length).toBe(2);
    expect(new Set(allies.map((a) => a.target))).toEqual(new Set([1, 2]));
  });

  it("does NOT emit ally actions for already-allied targets", () => {
    let s = mk(true);
    // Pre-set player 0 and player 1 as allies.
    s = {
      ...s,
      players: s.players.map((p) => {
        if (p.id === 0) return { ...p, alliance: [0, 1] };
        if (p.id === 1) return { ...p, alliance: [1, 0] };
        return p;
      }),
    };
    const acts = legalActions(s);
    const allies = acts.filter((a) => a.kind === "ally") as Extract<Action, { kind: "ally" }>[];
    // Only player 2 remains as a valid target.
    expect(allies.length).toBe(1);
    expect(allies[0]!.target).toBe(2);
  });

  it("does NOT emit ally actions when actor has allianceCooldownTurns > 0", () => {
    let s = mk(true);
    s = {
      ...s,
      players: s.players.map((p) => (p.id === 0 ? { ...p, allianceCooldownTurns: 1 } : p)),
    };
    const acts = legalActions(s);
    expect(acts.some((a) => a.kind === "ally")).toBe(false);
  });

  it("does NOT emit ally actions when actor has basesInHand === 0 (commit cost requires 1)", () => {
    let s = mk(true);
    s = {
      ...s,
      players: s.players.map((p) => (p.id === 0 ? { ...p, basesInHand: 0 } : p)),
    };
    const acts = legalActions(s);
    expect(acts.some((a) => a.kind === "ally")).toBe(false);
  });

  it("does NOT emit ally actions targeting eliminated players", () => {
    let s = mk(true);
    s = {
      ...s,
      players: s.players.map((p) => (p.id === 2 ? { ...p, eliminated: true } : p)),
    };
    const acts = legalActions(s);
    const allies = acts.filter((a) => a.kind === "ally") as Extract<Action, { kind: "ally" }>[];
    expect(allies.length).toBe(1);
    expect(allies[0]!.target).toBe(1);
  });
});

describe("alliance layer Phase 3 — `break-alliance` action legality", () => {
  function mkAllied(): GameState {
    const cfg = { ...defaultConfig(), alliancesEnabled: true };
    let s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      basesP2: [hex(0, 20, -20)],
      iron: [hex(1, -1, 0), hex(20, -19, -1), hex(0, 19, -19)],
      config: cfg,
    });
    // Pre-ally p0 and p1.
    s = {
      ...s,
      players: s.players.map((p) => {
        if (p.id === 0) return { ...p, alliance: [0, 1] };
        if (p.id === 1) return { ...p, alliance: [1, 0] };
        return p;
      }),
    };
    return s;
  }

  it("does NOT emit break-alliance when alliancesEnabled is false", () => {
    let s = mkAllied();
    s = { ...s, config: { ...s.config, alliancesEnabled: false } };
    const acts = legalActions(s);
    expect(acts.some((a) => a.kind === "break-alliance")).toBe(false);
  });

  it("emits one break-alliance per current ally for the actor", () => {
    const s = mkAllied();
    const acts = legalActions(s);
    const breaks = acts.filter((a) => a.kind === "break-alliance") as Extract<Action, { kind: "break-alliance" }>[];
    expect(breaks.length).toBe(1);
    expect(breaks[0]!.target).toBe(1);
  });

  it("does NOT emit break-alliance against the SELF entry in the alliance array", () => {
    const s = mkAllied();
    const acts = legalActions(s);
    const breaks = acts.filter((a) => a.kind === "break-alliance") as Extract<Action, { kind: "break-alliance" }>[];
    expect(breaks.every((b) => b.target !== 0)).toBe(true);
  });

  it("does NOT emit break-alliance against eliminated allies", () => {
    let s = mkAllied();
    s = { ...s, players: s.players.map((p) => (p.id === 1 ? { ...p, eliminated: true } : p)) };
    const acts = legalActions(s);
    expect(acts.some((a) => a.kind === "break-alliance")).toBe(false);
  });

  it("does NOT emit break-alliance when actor has allianceCooldownTurns > 0", () => {
    let s = mkAllied();
    s = { ...s, players: s.players.map((p) => (p.id === 0 ? { ...p, allianceCooldownTurns: 1 } : p)) };
    const acts = legalActions(s);
    expect(acts.some((a) => a.kind === "break-alliance")).toBe(false);
  });
});
