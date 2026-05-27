// ABOUTME: Tests for stepRound — the shared per-round body (apply -> eliminate -> remove-stranded) used by the driver AND MCTS.
// ABOUTME: Seeded/structural; the load-bearing case is equivalence with the driver's prior inline sequence on a fixture.

import { describe, expect, it } from "vitest";
import { stepRound } from "../../src/engine/round";
import { applyAction } from "../../src/engine/apply";
import { applyEliminations } from "../../src/engine/status";
import { removeEncircledStrandedBases } from "../../src/engine/stranded";
import { currentPlayer } from "../../src/engine/turn";
import { mkState } from "../helpers/state";
import type { Action, GameState } from "../../src/engine/types";

const PASS: Action = { kind: "pass" };

// Normalized base snapshot for structural comparison (GEO-4 keyed, sorted).
const normBases = (s: GameState): string[] =>
  s.bases.map((b) => `${b.owner}@${b.hex.x},${b.hex.y},${b.hex.z}:${b.state}:${b.order}`).sort();

describe("stepRound", () => {
  it("applies the action, runs eliminations for the acting player, removes encircled stranded bases, concatenating events", () => {
    // p1 has a single base with no iron -> after p0 acts, p1 is eliminated by
    // applyEliminations (noIron / noBases path), producing an elimination event.
    const state = mkState({
      board: 96,
      basesP0: [{ x: 0, y: 0, z: 0 }, { x: 2, y: -2, z: 0 }, { x: 4, y: -4, z: 0 }],
      basesP1: [{ x: 0, y: 4, z: -4 }],
      iron: [{ x: 5, y: -5, z: 0 }],
    });
    // A build action for p0 (place a factory at a legal interior hex) so the action
    // produces a "placed" event.
    const build: Action = { kind: "build", pieces: [{ type: "factory", hex: { x: 3, y: 1, z: -4 } }] };

    const acting = currentPlayer(state); // 0
    const result = stepRound(state, build);

    // Equivalence with the explicit composed pipeline.
    const a = applyAction(state, build);
    const e = applyEliminations(a.state, acting);
    const s = removeEncircledStrandedBases(e.state);

    expect(normBases(result.state)).toEqual(normBases(s.state));
    expect(result.state.players.map((p) => p.eliminated)).toEqual(s.state.players.map((p) => p.eliminated));
    expect(result.state.players.map((p) => p.basesInHand)).toEqual(s.state.players.map((p) => p.basesInHand));
    expect(result.events).toEqual([...a.events, ...e.events, ...s.events]);
    // Pipeline produced at least the placement and an elimination event.
    expect(result.events.some((ev) => ev.kind === "placed")).toBe(true);
    expect(result.events.some((ev) => ev.kind === "eliminated")).toBe(true);
  });

  it("uses currentPlayer(state) BEFORE the action as the byPlayer for eliminations", () => {
    // Put p1 at the wheel so the acting player is 1, not 0.
    const base = mkState({
      board: 96,
      basesP0: [{ x: 0, y: 4, z: -4 }],
      basesP1: [{ x: 0, y: 0, z: 0 }, { x: 2, y: -2, z: 0 }, { x: 4, y: -4, z: 0 }],
      iron: [{ x: 5, y: -5, z: 0 }],
    });
    const state: GameState = { ...base, phase: { ...base.phase, indexInOrder: 1 } };
    expect(currentPlayer(state)).toBe(1);

    const acting = currentPlayer(state);
    const result = stepRound(state, PASS);

    const a = applyAction(state, PASS);
    const e = applyEliminations(a.state, acting);
    const s = removeEncircledStrandedBases(e.state);
    expect(result.events).toEqual([...a.events, ...e.events, ...s.events]);
    expect(result.state.players.map((p) => p.eliminated)).toEqual(s.state.players.map((p) => p.eliminated));
  });

  it("is pure — the input state is not mutated", () => {
    const state = mkState({
      board: 96,
      basesP0: [{ x: 0, y: 0, z: 0 }],
      basesP1: [{ x: 0, y: 4, z: -4 }],
      iron: [{ x: 5, y: -5, z: 0 }],
    });
    const basesBefore = normBases(state);
    const playersBefore = state.players.map((p) => ({ ...p }));
    stepRound(state, PASS);
    expect(normBases(state)).toEqual(basesBefore);
    expect(state.players).toEqual(playersBefore);
  });

  it("matches the driver's prior inline behavior (applyAction -> applyEliminations -> removeEncircledStranded)", () => {
    // The exact sequence the driver ran before extraction. stepRound must reproduce
    // it on a representative fixture where all three steps do real work.
    const state = mkState({
      board: 96,
      basesP0: [{ x: 0, y: 0, z: 0 }, { x: 2, y: -2, z: 0 }, { x: 4, y: -4, z: 0 }],
      basesP1: [{ x: 0, y: 4, z: -4 }],
      iron: [{ x: 5, y: -5, z: 0 }],
    });
    const action: Action = { kind: "build", pieces: [{ type: "factory", hex: { x: 3, y: 1, z: -4 } }] };
    const player = currentPlayer(state);

    // Driver-prior inline body:
    let inline = applyAction(state, action).state;
    inline = applyEliminations(inline, player).state;
    inline = removeEncircledStrandedBases(inline).state;

    const viaHelper = stepRound(state, action).state;
    expect(normBases(viaHelper)).toEqual(normBases(inline));
    expect(viaHelper.players.map((p) => p.eliminated)).toEqual(inline.players.map((p) => p.eliminated));
    expect(viaHelper.players.map((p) => p.basesInHand)).toEqual(inline.players.map((p) => p.basesInHand));
  });
});
