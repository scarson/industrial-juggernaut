// ABOUTME: Tests for session validation — the §3 defense-in-depth checks (forced-pass, target-attackable, attack-decl, build set).
// ABOUTME: Asserts on structured error codes; reuses verified on-board coordinates from apply-attack fixtures.
import { test, expect } from "vitest";
import { validatePass, validateTargetAttackable, validateAttackDecl, validateBuildPieces } from "../../src/session/validation";
import { hex } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";

test("pass rejected when allowPass is false and a non-pass action exists", () => {
  // a player with budget + a legal build => pass is not forced.
  const s = mkState({ board: 96, basesP0: [hex(0,0,0)], iron: [hex(1,0,-1), hex(0,1,-1)] }); // rc=2 -> base/factory legal
  const err = validatePass(s);
  expect(err).not.toBeNull();
  expect(err!.code).toBe("PASS_NOT_FORCED");
});

test("pass allowed when the only legal action is pass (forced-pass)", () => {
  // Use allowPass:false default — but craft a state where legalActions yields only pass.
  // A player with no bases in hand and no factories to build (basesInHand=0) forces pass.
  const base = mkState({ board: 96, basesP0: [hex(0,0,0)], iron: [hex(1,0,-1), hex(0,1,-1)] });
  // Exhaust basesInHand so no build is possible.
  const s = { ...base, players: base.players.map((p) => p.id === 0 ? { ...p, basesInHand: 0 } : p) };
  // Also set factorySupply to 0 so no factory build either.
  const s2 = { ...s, factorySupply: 0 };
  const err = validatePass(s2);
  expect(err).toBeNull();
});

test("attack decl with duplicate attackers is rejected", () => {
  const s = mkState({ board: 96, basesP0: [hex(0,0,0)], basesP1: [hex(2,-2,0), hex(0,-1,1)] });
  const err = validateAttackDecl(s, 1, { target: hex(2,-2,0), attackers: [hex(0,0,0), hex(0,0,0)], defender: hex(0,-1,1) });
  expect(err?.code).toBe("DUP_ATTACKERS");
});

test("attack decl with defender === target is rejected", () => {
  const s = mkState({ board: 96, basesP0: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], basesP1: [hex(2,-2,0)] });
  const err = validateAttackDecl(s, 1, { target: hex(2,-2,0), attackers: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], defender: hex(2,-2,0) });
  expect(err?.code).toBe("DEFENDER_IS_TARGET");
});

test("build pieces of mixed type are rejected", () => {
  expect(validateBuildPieces([{ type: "factory", hex: hex(-1,1,0) }, { type: "base", hex: hex(0,-1,1) }])?.code).toBe("MIXED_PIECE_TYPES");
});

test("build pieces with duplicate hex are rejected", () => {
  expect(validateBuildPieces([{ type: "factory", hex: hex(-1,1,0) }, { type: "factory", hex: hex(-1,1,0) }])?.code).toBe("DUP_PIECES");
});

test("a clean single-type piece set passes", () => {
  expect(validateBuildPieces([{ type: "factory", hex: hex(-1,1,0) }])).toBeNull();
});

// check 4a: target with no eligible defender → NO_ELIGIBLE_DEFENDER
test("validateTargetAttackable returns NO_ELIGIBLE_DEFENDER when target is the opponent's only base", () => {
  // p1 has only hex(2,-2,0); representativeDefender(state, target, 1) === null
  const s = mkState({ board: 96, basesP0: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], basesP1: [hex(2,-2,0)] });
  const err = validateTargetAttackable(s, hex(2,-2,0), 1);
  expect(err).not.toBeNull();
  expect(err!.code).toBe("NO_ELIGIBLE_DEFENDER");
});

test("validateTargetAttackable returns null when a defender exists", () => {
  // p1 has both target and a separate defender base
  const s = mkState({ board: 96, basesP0: [hex(0,0,0)], basesP1: [hex(2,-2,0), hex(0,-1,1)] });
  const err = validateTargetAttackable(s, hex(2,-2,0), 1);
  expect(err).toBeNull();
});

// check 4b: fatigued submitted defender → DEFENDER_INELIGIBLE
test("validateAttackDecl returns DEFENDER_INELIGIBLE when submitted defender is fatigued", () => {
  // p1 has target base at (2,-2,0) and defender base at (0,-1,1); fatigue the defender
  const s = mkState({ board: 96, basesP0: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], basesP1: [hex(2,-2,0), hex(0,-1,1)] });
  // Mutate the defender base state to "fatigued" (mirrors how engine tests fatigue bases)
  const fatigued = { ...s, bases: s.bases.map((b) => b.owner === 1 && b.hex.x === 0 && b.hex.y === -1 && b.hex.z === 1 ? { ...b, state: "fatigued" as const } : b) };
  const err = validateAttackDecl(fatigued, 1, { target: hex(2,-2,0), attackers: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], defender: hex(0,-1,1) });
  expect(err?.code).toBe("DEFENDER_INELIGIBLE");
});

// check 4b: a valid decl with a fresh in-range defender passes
test("validateAttackDecl returns null for a valid complete declaration", () => {
  const s = mkState({ board: 96, basesP0: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], basesP1: [hex(2,-2,0), hex(0,-1,1)] });
  const err = validateAttackDecl(s, 1, { target: hex(2,-2,0), attackers: [hex(0,0,0),hex(-1,1,0),hex(0,1,-1)], defender: hex(0,-1,1) });
  expect(err).toBeNull();
});
