// ABOUTME: Pins highlightSets() against a fixed setup-phase state (placement highlighting)
// ABOUTME: and a fixed play-phase state (build/attack highlighting derived from legalActions).
import { describe, expect, test } from "vitest";
import { highlightSets } from "./highlight";
import { hexKey } from "./projection";
import {
  initGame,
  placeFirstBase,
  legalFirstBaseHexes,
  legalActions,
  defaultConfig,
} from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";

function setupPhaseState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

// Exits setup by placing each seat's first base at legalFirstBaseHexes(state)[0] — a fixed,
// deterministic pick (not random) so the resulting play-phase state is reproducible.
function playPhaseState(): GameState {
  let state = setupPhaseState();
  while (state.phase.turn === 0) {
    const player = state.phase.order[state.phase.indexInOrder]!;
    const hex = legalFirstBaseHexes(state)[0]!;
    state = placeFirstBase(state, player, hex);
  }
  return state;
}

describe("highlightSets", () => {
  test("memoizes on the state reference (GEO-5 identity cache)", () => {
    const state = playPhaseState();
    // Same state reference → the identical HighlightSets object (no re-enumeration).
    expect(highlightSets(state)).toBe(highlightSets(state));
    // A different state object → a fresh result.
    const other = playPhaseState();
    expect(highlightSets(other)).not.toBe(highlightSets(state));
  });

  test("setup phase: placementHexes matches legalFirstBaseHexes, build/attack empty", () => {
    const state = setupPhaseState();
    const sets = highlightSets(state);

    const expectedPlacement = new Set(legalFirstBaseHexes(state).map(hexKey));
    expect(sets.placementHexes).toEqual(expectedPlacement);
    expect(sets.placementHexes.size).toBeGreaterThan(0);
    expect(sets.buildHexes.size).toBe(0);
    expect(sets.attackTargets.size).toBe(0);
  });

  test("play phase: buildHexes/attackTargets match a hexes-that-appear-in-some-legal-action derivation from legalActions, placementHexes empty", () => {
    const state = playPhaseState();

    // Independent derivation, mirroring the extraction the task describes: iterate the actions
    // directly rather than importing the implementation under test.
    const expectedBuild = new Set<string>();
    const expectedAttack = new Set<string>();
    for (const action of legalActions(state)) {
      if (action.kind === "build") {
        for (const piece of action.pieces) expectedBuild.add(hexKey(piece.hex));
      } else if (action.kind === "attack") {
        for (const decl of action.attacks) expectedAttack.add(hexKey(decl.target));
      }
    }

    const sets = highlightSets(state);
    expect(sets.buildHexes).toEqual(expectedBuild);
    expect(sets.attackTargets).toEqual(expectedAttack);
    expect(sets.placementHexes.size).toBe(0);

    expect(sets.buildHexes.size).toBeGreaterThan(0);
    const onBoardKeys = new Set(state.board.hexes.map(hexKey));
    for (const h of sets.buildHexes) expect(onBoardKeys.has(h)).toBe(true);

    // Early 2-base game: no pair is in attack range/commitment yet, so no attack actions exist.
    // If that assumption ever breaks (board/config changes), fail loudly rather than silently
    // asserting an empty set that no longer reflects the fixture.
    expect(expectedAttack.size).toBe(0);
    expect(sets.attackTargets.size).toBe(0);
  });
});
