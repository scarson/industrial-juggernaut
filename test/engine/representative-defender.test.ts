// ABOUTME: Tests for representativeDefender — the deterministic nearest-eligible-defender selector.
// ABOUTME: Also pins that legalActions resolves each emitted attack's defender via representativeDefender.
import { test, expect } from "vitest";
import { hex, key, distance } from "../../src/geometry/cube";
import { legalActions, representativeDefender } from "../../src/engine/legal";
import { defaultConfig } from "../../src/engine/config";
import { mkState } from "../helpers/state";

// On-board coordinates for the seed-1n/size-96 board, verified by apply-attack fixtures.
const TARGET = hex(2, -2, 0);
// D1 at distance 2 from TARGET.
const D1 = hex(0, -1, 1);
// D2 at distance 4 from TARGET — further than D1 but within attackRange (6).
const D2 = hex(-2, 2, 0);
// A second base at distance 2 from TARGET for tie-breaking (same d as D1).
// key("2,-4,2") > key("0,-1,1"), so D1 wins tie by ascending key.
const D_TIE = hex(2, -4, 2);
// Standard attacker set for p0 (radiating fixture, 6 fresh bases in range of TARGET).
const ATTACKERS6 = [
  hex(0, 0, 0),
  hex(-1, 1, 0),
  hex(0, 1, -1),
  hex(1, 0, -1),
  hex(0, 2, -2),
  D2, // also serves as p0 attacker in the non-bootstrap fixture
];

test("returns the nearer of two fresh in-range defenders", () => {
  // p1 owns D1 (d=2) and D2 (d=4); both fresh and in range. D1 is nearer => wins.
  const state = mkState({
    board: 96,
    basesP0: ATTACKERS6,
    basesP1: [TARGET, D1, D2],
    iron: [hex(0, 0, 0)], // ensure non-bootstrap for p0
  });
  const result = representativeDefender(state, TARGET, 1);
  expect(result).not.toBeNull();
  expect(key(result!)).toBe(key(D1));
});

test("breaks ties by ascending canonical key", () => {
  // p1 owns D1 (d=2) and D_TIE (d=2); key(D1)="0,-1,1" < key(D_TIE)="2,-4,2" => D1 wins.
  const state = mkState({
    board: 96,
    basesP0: ATTACKERS6,
    basesP1: [TARGET, D1, D_TIE],
    iron: [hex(0, 0, 0)],
  });
  const result = representativeDefender(state, TARGET, 1);
  expect(result).not.toBeNull();
  expect(key(result!)).toBe(key(D1));
  // Confirm D1 and D_TIE are equidistant from TARGET.
  expect(distance(D1, TARGET)).toBe(distance(D_TIE, TARGET));
  // Confirm key ordering.
  expect(key(D1) < key(D_TIE)).toBe(true);
});

test("returns null when the only candidate is the target itself (excluded by design)", () => {
  // p1 has only the target base — no OTHER fresh in-range base exists.
  const state = mkState({
    board: 96,
    basesP0: ATTACKERS6,
    basesP1: [TARGET],
    iron: [hex(0, 0, 0)],
  });
  const result = representativeDefender(state, TARGET, 1);
  expect(result).toBeNull();
});

test("returns null when all other candidates are fatigued", () => {
  const state = mkState({
    board: 96,
    basesP0: ATTACKERS6,
    basesP1: [TARGET, D1],
    iron: [hex(0, 0, 0)],
  });
  // Fatigue D1 so it is ineligible.
  const idx = state.bases.findIndex((b) => b.owner === 1 && key(b.hex) === key(D1));
  state.bases[idx] = { ...state.bases[idx]!, state: "fatigued" };
  const result = representativeDefender(state, TARGET, 1);
  expect(result).toBeNull();
});

test("returns null when all other candidates are out of range", () => {
  // attackRange 1: D1 is d=2 from TARGET, so it falls outside range.
  const cfg = { ...defaultConfig(), attackRange: 1 };
  // D1 is d=2 from TARGET; attackRange 1 => D1 is out of range too.
  const state = mkState({
    board: 96,
    basesP0: ATTACKERS6,
    basesP1: [TARGET, D1],
    config: cfg,
    iron: [hex(0, 0, 0)],
  });
  const result = representativeDefender(state, TARGET, 1);
  expect(result).toBeNull();
});

test("legalActions resolves each emitted attack's defender via representativeDefender", () => {
  // Non-bootstrap fixture: p0 has iron + 6 attackers, p1 has TARGET + D1.
  const state = mkState({
    board: 96,
    basesP0: ATTACKERS6,
    basesP1: [TARGET, D1],
    iron: [hex(0, 0, 0)],
  });
  const actions = legalActions(state);
  const attacks = actions.filter((a) => a.kind === "attack");
  expect(attacks.length).toBeGreaterThan(0);

  for (const action of attacks) {
    if (action.kind !== "attack") continue;
    for (const decl of action.attacks) {
      const targetOwner = state.bases.find((b) => key(b.hex) === key(decl.target))!.owner;
      const expected = representativeDefender(state, decl.target, targetOwner);
      expect(expected).not.toBeNull();
      expect(key(decl.defender)).toBe(key(expected!));
    }
  }
});
