import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import { control } from "../../src/engine/control";
import { scoreMove, type Weights } from "../../src/agent/score";
import { mkState } from "../helpers/state";
import type { Action, AttackDecl } from "../../src/engine/types";

// Generic weights: iron dominates (it's the victory metric), then factories, then area.
const W: Weights = { iron: 100, fact: 10, area: 1, aggr: 1, fatigueCost: 0.5 };

describe("scoreMove", () => {
  it("pass is a small constant (last resort)", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)] });
    expect(scoreMove(s, 0, { kind: "pass" }, W)).toBe(0);
  });

  it("a build that increases controlled iron scores higher than one that does not", () => {
    // p0 has 2 bases controlling 2 iron (budget 1); both candidate 3rd-base
    // placements are legal. One reaches a NEW iron hex; the other reaches none.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(0, 3, -3)],
      iron: [hex(2, -1, -1), hex(2, 2, -4), hex(6, -3, -3)],
    });
    expect(control(s, 0).iron.length).toBe(2);

    const grabsIron: Action = { kind: "build", pieces: [{ type: "base", hex: hex(4, -2, -2) }] };
    const noNewIron: Action = { kind: "build", pieces: [{ type: "base", hex: hex(-2, 1, 1) }] };

    const scoreGrab = scoreMove(s, 0, grabsIron, W);
    const scoreNone = scoreMove(s, 0, noNewIron, W);
    // The iron-grabbing build must rank strictly higher (controlled-iron delta is
    // the dominant signal, weight 100).
    expect(scoreGrab).toBeGreaterThan(scoreNone);
  });

  it("4th base whose perimeter encloses zero iron is hard-pruned to -Infinity", () => {
    // 3 bases radiating onto 1 iron; the 4th base closes a tight diamond around
    // the origin that encloses NO iron => empty-perimeter self-destruct.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(2, 0, -2)],
      iron: [hex(5, -3, -2)],
    });
    expect(control(s, 0).iron.length).toBe(1);

    const fourthBase: Action = { kind: "build", pieces: [{ type: "base", hex: hex(0, 2, -2) }] };
    expect(scoreMove(s, 0, fourthBase, W)).toBe(-Infinity);
  });

  it("a build that drops a currently-held iron hex is heavily penalized", () => {
    // 3 bases radiating hold 2 iron; the 4th base flips to a perimeter that still
    // encloses 1 iron but drops the other (dIron = -1) => heavy 1e6 penalty (NOT
    // the zero-iron -Infinity prune, since one iron remains).
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(2, 0, -2)],
      iron: [hex(1, -1, 0), hex(4, -2, -2)],
    });
    expect(control(s, 0).iron.length).toBe(2);

    const dropsIron: Action = { kind: "build", pieces: [{ type: "base", hex: hex(0, 2, -2) }] };
    const score = scoreMove(s, 0, dropsIron, W);
    expect(Number.isFinite(score)).toBe(true); // not the -Infinity prune
    // Sits far below any neutral move (pass = 0): the 1e6 iron-drop penalty dominates.
    expect(score).toBeLessThan(-100000);
  });

  it("a factory placed outside the resulting perimeter is penalized relative to one inside", () => {
    // p0 is in the perimeter regime (4 non-degenerate bases). One factory lands
    // inside the hull (controlled); the other lands outside it (orphaned).
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)],
      iron: [hex(2, -2, 0), hex(2, -1, -1)],
    });
    const inside = hex(1, 1, -2); // interior, non-iron
    const outside = hex(6, -3, -3); // within placeRange of a base but outside the hull
    expect(control(s, 0).hexes.has(key(inside))).toBe(true);
    expect(control(s, 0).hexes.has(key(outside))).toBe(false);

    const facInside: Action = { kind: "build", pieces: [{ type: "factory", hex: inside }] };
    const facOutside: Action = { kind: "build", pieces: [{ type: "factory", hex: outside }] };
    expect(scoreMove(s, 0, facInside, W)).toBeGreaterThan(scoreMove(s, 0, facOutside, W));
  });

  it("attack scoring uses combat-table expected value (P(win) * resourcesGained - fatigue)", () => {
    // p0 in perimeter regime; the target opponent base sits on an iron hex p0 does
    // NOT yet control. With 3 attackers P(win)=0.75; capturing adds the iron =>
    // resourcesGained=1. aggr=1, fatigueCost=0 => score = 0.75 * 1 = 0.75.
    const evW: Weights = { iron: 1, fact: 1, area: 0, aggr: 1, fatigueCost: 0 };
    const p0 = [hex(0, 0, 0), hex(2, -2, 0), hex(2, 0, -2), hex(0, 2, -2)];
    const target = hex(5, -2, -3);
    const s = mkState({
      board: 96,
      basesP0: p0,
      basesP1: [target, hex(5, -1, -4)],
      iron: [target],
    });
    expect(control(s, 0).iron.length).toBe(0); // p0 does not yet control the target iron

    const decl: AttackDecl = {
      target,
      attackers: [hex(0, 0, 0), hex(2, -2, 0), hex(2, 0, -2)],
      defender: hex(5, -1, -4),
    };
    const move: Action = { kind: "attack", attacks: [decl] };
    expect(scoreMove(s, 0, move, evW)).toBeCloseTo(0.75, 10);
  });

  it("attack fatigue cost scales with the number of committed bases", () => {
    // Same capture, no resource gain (aggr*pWin*0), so score = -fatigueCost*commit.
    const evW: Weights = { iron: 1, fact: 1, area: 0, aggr: 1, fatigueCost: 0.5 };
    const p0 = [hex(0, 0, 0), hex(2, -2, 0), hex(2, 0, -2), hex(0, 2, -2)];
    // Target opponent base on a hex p0 already controls (interior) so resourcesGained=0.
    const target = hex(1, 0, -1);
    const s = mkState({
      board: 96,
      basesP0: p0,
      basesP1: [target, hex(2, -1, -1)],
      iron: [],
    });
    const decl: AttackDecl = {
      target,
      attackers: [hex(0, 0, 0), hex(2, -2, 0), hex(2, 0, -2)],
      defender: hex(2, -1, -1),
    };
    const move: Action = { kind: "attack", attacks: [decl] };
    // commit=3, pWin=0.75, gained=0 => 0.75*0 - 0.5*3 = -1.5.
    expect(scoreMove(s, 0, move, evW)).toBeCloseTo(-1.5, 10);
  });

  // LOAD-BEARING: scoring an attack must consume NO PRNG and be deterministic.
  it("scoring an ATTACK consumes no PRNG and is repeatable (state unmutated)", () => {
    const p0 = [hex(0, 0, 0), hex(1, -1, 0), hex(0, 1, -1)];
    const p1 = [hex(3, -2, -1), hex(4, -2, -2)];
    const s = mkState({ board: 96, basesP0: p0, basesP1: p1, iron: [hex(3, -2, -1)] });

    const rngRef = s.rngState;
    const stateBefore = s.rngState.state;
    const incBefore = s.rngState.inc;
    const basesLenBefore = s.bases.length;

    const decl: AttackDecl = { target: hex(3, -2, -1), attackers: p0, defender: hex(4, -2, -2) };
    const move: Action = { kind: "attack", attacks: [decl] };

    const first = scoreMove(s, 0, move, W);
    const second = scoreMove(s, 0, move, W);

    // Same score on repeated calls => no randomness consumed.
    expect(first).toBe(second);
    // PRNG state is untouched (same reference and same bigint fields).
    expect(s.rngState).toBe(rngRef);
    expect(s.rngState.state).toBe(stateBefore);
    expect(s.rngState.inc).toBe(incBefore);
    // Bases array is not mutated by the hand-built win-state.
    expect(s.bases.length).toBe(basesLenBefore);
  });
});
