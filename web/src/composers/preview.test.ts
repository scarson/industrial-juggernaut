// ABOUTME: Proves previewCommand's per-command routing — build/pass/placeFirstBase compute a real
// ABOUTME: preview state; attack NEVER pre-resolves combat (returns the input state unchanged, {combat:true}).
import { describe, expect, test } from "vitest";
import { previewCommand } from "./preview";
import { hex, key } from "../../../src/geometry/cube";
import { defaultConfig, initGame, placeFirstBase } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { DriverCommand } from "../game/driver";

// Setup-phase fixture (2 players, seed-1n/size-96 board) — deterministic across runs, mirrors the
// fixture shape used throughout web/src/{engine-client,game} tests.
function setupState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// A play-phase fixture for p0 with a controlled-iron bootstrap budget of 1: base at (0,0,0), iron
// at (5,-5,0) unioned onto the setup-phase board (adjacent to the base, radius 5, so it's
// controlled per control()'s radiating fallback below 4 bases). Reused verbatim across the build
// and placeFirstBase-adjacent assertions below; coordinates chosen to mirror
// test/engine/apply-build.test.ts's factoryFixture (same seed-1n/size-96 board, verified on-board).
const P0_BASE = hex(0, 0, 0);
const IRON = hex(5, -5, 0);
const FACTORY_TARGET = hex(3, -3, 0); // on-board, d=3 from P0_BASE, within default placeRange 5

function buildFixture(): GameState {
  const base = setupState();
  const present = new Set(base.board.hexes.map(key));
  const hexes = present.has(key(IRON)) ? base.board.hexes : [...base.board.hexes, IRON];
  return {
    ...base,
    board: { ...base.board, hexes, iron: [...base.board.iron, IRON] },
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [{ owner: 0, hex: P0_BASE, state: "fresh", order: 0 }],
    players: [
      { id: 0, basesInHand: 11, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 12, alliance: [1], eliminated: false },
    ],
  };
}

// Attack-legal fixture: p0 has 6 fresh bases within attackRange (6) of TARGET; p1 has 2 bases
// (target + defender), both within range. Coordinates verified on-board for seed-1n/size-96 in
// test/engine/apply-attack.test.ts — reused verbatim here.
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

function attackFixture(): GameState {
  const base = setupState();
  return {
    ...base,
    phase: { turn: 1, order: [0, 1], indexInOrder: 0 },
    bases: [
      ...ATTACKERS6.map((h, i) => ({ owner: 0 as const, hex: h, state: "fresh" as const, order: i })),
      { owner: 1 as const, hex: TARGET, state: "fresh" as const, order: 0 },
      { owner: 1 as const, hex: DEFENDER, state: "fresh" as const, order: 1 },
    ],
    players: [
      { id: 0, basesInHand: 6, alliance: [0], eliminated: false },
      { id: 1, basesInHand: 10, alliance: [1], eliminated: false },
    ],
  };
}

describe("previewCommand — build", () => {
  test("shows the new factory placed and the build budget decremented", () => {
    const state = buildFixture();
    const cmd: DriverCommand = { type: "build", pieces: [{ type: "factory", hex: FACTORY_TARGET }] };

    const result = previewCommand(state, 0, cmd);

    expect(result.combat).toBeUndefined();
    expect(result.state.factorySupply).toBe(state.factorySupply - 1);
    const factoryKeys = result.state.factories.map((f) => key(f.hex));
    expect(factoryKeys).toContain(key(FACTORY_TARGET));
    // Input state is untouched (applyAction is pure).
    expect(state.factories).toHaveLength(0);
  });
});

describe("previewCommand — pass", () => {
  test("returns the input state unchanged (applyAction(pass) is a no-op)", () => {
    const state = buildFixture();
    const cmd: DriverCommand = { type: "pass" };

    const result = previewCommand(state, 0, cmd);

    expect(result.combat).toBeUndefined();
    expect(result.state).toBe(state);
  });
});

describe("previewCommand — placeFirstBase", () => {
  test("shows the new base placed via placeFirstBase, not applyAction", () => {
    const state = setupState();
    const p = state.phase.order[state.phase.indexInOrder]!;
    const targetHex = state.board.hexes.find(
      (h) => !state.bases.some((b) => key(b.hex) === key(h)),
    )!;
    // representativeFirstBase-independent: just confirm previewCommand routes through
    // placeFirstBase by comparing against calling it directly with the same args.
    const expected = placeFirstBase(state, p, targetHex);
    const cmd: DriverCommand = { type: "placeFirstBase", hex: targetHex };

    const result = previewCommand(state, p, cmd);

    expect(result.combat).toBeUndefined();
    expect(result.state).toEqual(expected);
    expect(result.state.bases.some((b) => key(b.hex) === key(targetHex) && b.owner === p)).toBe(true);
    // Input state is untouched.
    expect(state.bases.some((b) => key(b.hex) === key(targetHex))).toBe(false);
  });
});

describe("previewCommand — attack", () => {
  test("returns the input state UNCHANGED and {combat:true} — never pre-resolves the RNG draw", () => {
    const state = attackFixture();
    const cmd: DriverCommand = {
      type: "attack",
      decl: { target: TARGET, attackers: ATTACKERS6, defender: DEFENDER },
    };

    const result = previewCommand(state, 0, cmd);

    expect(result.combat).toBe(true);
    // The load-bearing property (decision #6/G1): an attack preview must not consume RNG.
    // rngState is asserted identical (reference-equal — previewCommand doesn't even read it).
    expect(result.state.rngState).toBe(state.rngState);
    expect(result.state.bases).toBe(state.bases);
    expect(result.state).toBe(state);
  });
});

describe("previewCommand — no-preview commands", () => {
  test("endRound returns the input state unchanged", () => {
    const state = buildFixture();
    const result = previewCommand(state, 0, { type: "endRound" });
    expect(result.combat).toBeUndefined();
    expect(result.state).toBe(state);
  });

  test("resolveDecision returns the input state unchanged", () => {
    const state = buildFixture();
    const result = previewCommand(state, 0, {
      type: "resolveDecision",
      decisionId: "d1",
      defender: DEFENDER,
    });
    expect(result.combat).toBeUndefined();
    expect(result.state).toBe(state);
  });

  test("extendDecision returns the input state unchanged", () => {
    const state = buildFixture();
    const result = previewCommand(state, 0, { type: "extendDecision", decisionId: "d1" });
    expect(result.combat).toBeUndefined();
    expect(result.state).toBe(state);
  });
});
