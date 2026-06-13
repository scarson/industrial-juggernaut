// ABOUTME: Bootstrap-state build legality — the founding single-base bootstrap +1 budget is factory-only.
// ABOUTME: Regression guards: base placement stays legal at rc>=2, and for any multi-base player at rc=1.

import { test, expect } from "vitest";
import { hex } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import { legalActions } from "../../src/engine/legal";
import { applyAction } from "../../src/engine/apply";

// Base at origin; mkState auto-adds provided iron hexes to the board, so they are
// guaranteed on-board and within radius 5 of the base → controlled iron.
const BUILD_HEX = hex(-1, 1, 0); // empty, on-board, within placeRange of origin, not iron in these states

test("bootstrap-only player (rc=1): legalActions offers a factory but no base", () => {
  // p0: 1 base, 1 controlled iron, 0 factories → floor(1/2)=0 → bootstrap-only.
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(1, 0, -1)] });
  const acts = legalActions(state);
  expect(acts.some(a => a.kind === "build" && a.pieces[0]!.type === "factory")).toBe(true);
  expect(acts.some(a => a.kind === "build" && a.pieces[0]!.type === "base")).toBe(false);
});

test("bootstrap-only player: applyAction(build base) throws factory-only", () => {
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(1, 0, -1)] });
  expect(() => applyAction(state, { kind: "build", pieces: [{ type: "base", hex: BUILD_HEX }] }))
    .toThrow(/factory-only/i);
});

// REGRESSION GUARD: do NOT suppress legal radiating base placement at rc>=2.
test("radiating player (rc=2, <4 bases, 0 factories): base build stays legal", () => {
  // p0: 1 base, 2 controlled iron, 0 factories → floor(2/2)=1 → NOT bootstrap-only.
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(1, 0, -1), hex(0, 1, -1)] });
  const acts = legalActions(state);
  expect(acts.some(a => a.kind === "build" && a.pieces[0]!.type === "base")).toBe(true);
  expect(() => applyAction(state, { kind: "build", pieces: [{ type: "base", hex: BUILD_HEX }] })).not.toThrow();
});

// REGRESSION GUARD: bootstrap-only is scoped to the FOUNDING single base. A multi-base
// player at resource count 1 (e.g. radiating onto one iron, or knocked back below the
// perimeter) keeps building bases on the bootstrap +1 budget — this is validated engine
// behavior pinned by the agent score/policy suite. A baseCount<4 gate would wrongly
// suppress it (the perimeter-forming 4th base here), so guard it directly.
test("multi-base player at rc=1 (3 bases, 0 factories) is NOT bootstrap-only: base build stays legal", () => {
  // 3 bases radiating onto 1 iron → floor(1/2)=0 but baseCount=3, so NOT bootstrap-only.
  const state = mkState({
    board: 96,
    basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(2, 0, -2)],
    iron: [hex(5, -3, -2)],
  });
  const FOURTH = hex(0, 2, -2); // legal perimeter-forming 4th base in this fixture
  const acts = legalActions(state);
  expect(acts.some(a => a.kind === "build" && a.pieces[0]!.type === "base")).toBe(true);
  expect(() => applyAction(state, { kind: "build", pieces: [{ type: "base", hex: FOURTH }] })).not.toThrow();
});
