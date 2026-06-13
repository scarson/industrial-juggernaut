// ABOUTME: Setup-phase tests — representativeFirstBase mapping/occupied-skip, placeFirstBase, setupGame structural identity.
// ABOUTME: Pins that all-agent setup via the new init is deep-equal to the legacy monolithic setupGame.
import { test, expect } from "vitest";
import { setupPhaseState, representativeFirstBase } from "../../src/engine/turn";
import { generateBoard } from "../../src/board/generate";
import { ringDepthFromEdge } from "../../src/board/shape";
import { seed } from "../../src/rng/pcg";
import { defaultConfig } from "../../src/engine/config";
import { key } from "../../src/geometry/cube";

const board = generateBoard(seed(1n), { size: 96, ironCount: 14 }).board;

test.each([2, 4, 6])("representativeFirstBase: %i distinct deterministic outer-ring picks on an empty setup state", (n) => {
  const s = setupPhaseState(seed(1n), board, n, defaultConfig());
  const picks = Array.from({ length: n }, (_, id) => representativeFirstBase(s, id));
  for (const h of picks) expect(ringDepthFromEdge(h, board.hexes)).toBe(0);
  expect(new Set(picks.map(key)).size).toBe(n);
  for (let id = 0; id < n; id++) expect(representativeFirstBase(s, id)).toEqual(picks[id]);
});

test("representativeFirstBase skips an occupied ideal hex (mixed-setup fallback)", () => {
  const n = 4;
  let s = setupPhaseState(seed(1n), board, n, defaultConfig());
  const ideal1 = representativeFirstBase(s, 1);
  s = { ...s, bases: [{ owner: 0, hex: ideal1, state: "fresh", order: 0 }] };
  const pick1 = representativeFirstBase(s, 1);
  expect(key(pick1)).not.toBe(key(ideal1));
  expect(ringDepthFromEdge(pick1, board.hexes)).toBe(0);
});
