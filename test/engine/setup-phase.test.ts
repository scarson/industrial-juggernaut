// ABOUTME: Setup-phase tests — representativeFirstBase mapping/occupied-skip, placeFirstBase, setupGame structural identity.
// ABOUTME: Pins that all-agent setup (setupGame) is deep-equal to its captured golden snapshot.
import { test, expect } from "vitest";
import { setupGame, setupPhaseState, representativeFirstBase, placeFirstBase, legalFirstBaseHexes, advanceRound } from "../../src/engine/turn";
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

// Golden snapshots of setupGame's output (seed(1n), board above) — the deep-equal target for all-agent setup.
const EXPECTED_SETUP: Record<number, { bases: any; players: any; phase: any; factorySupply: number; rngState: { state: bigint; inc: bigint } }> = {
  2: {
    bases: [{"owner":0,"hex":{"x":-5,"y":6,"z":-1},"state":"fresh","order":0},{"owner":1,"hex":{"x":5,"y":-6,"z":1},"state":"fresh","order":1}],
    players: [{"id":0,"basesInHand":11,"alliance":[0],"eliminated":false},{"id":1,"basesInHand":11,"alliance":[1],"eliminated":false}],
    phase: {"turn":1,"order":[0,1],"indexInOrder":0},
    factorySupply: 36,
    rngState: { state: 8356584029254049972n, inc: 109n },
  },
  4: {
    bases: [{"owner":0,"hex":{"x":-5,"y":6,"z":-1},"state":"fresh","order":0},{"owner":1,"hex":{"x":3,"y":1,"z":-4},"state":"fresh","order":1},{"owner":2,"hex":{"x":5,"y":-6,"z":1},"state":"fresh","order":2},{"owner":3,"hex":{"x":-3,"y":-1,"z":4},"state":"fresh","order":3}],
    players: [{"id":0,"basesInHand":11,"alliance":[0],"eliminated":false},{"id":1,"basesInHand":11,"alliance":[1],"eliminated":false},{"id":2,"basesInHand":11,"alliance":[2],"eliminated":false},{"id":3,"basesInHand":11,"alliance":[3],"eliminated":false}],
    phase: {"turn":1,"order":[0,2,3,1],"indexInOrder":0},
    factorySupply: 36,
    rngState: { state: 13234154825776909930n, inc: 109n },
  },
  6: {
    bases: [{"owner":0,"hex":{"x":-5,"y":6,"z":-1},"state":"fresh","order":0},{"owner":1,"hex":{"x":0,"y":4,"z":-4},"state":"fresh","order":1},{"owner":2,"hex":{"x":5,"y":-1,"z":-4},"state":"fresh","order":2},{"owner":3,"hex":{"x":5,"y":-6,"z":1},"state":"fresh","order":3},{"owner":4,"hex":{"x":0,"y":-4,"z":4},"state":"fresh","order":4},{"owner":5,"hex":{"x":-5,"y":1,"z":4},"state":"fresh","order":5}],
    players: [{"id":0,"basesInHand":11,"alliance":[0],"eliminated":false},{"id":1,"basesInHand":11,"alliance":[1],"eliminated":false},{"id":2,"basesInHand":11,"alliance":[2],"eliminated":false},{"id":3,"basesInHand":11,"alliance":[3],"eliminated":false},{"id":4,"basesInHand":11,"alliance":[4],"eliminated":false},{"id":5,"basesInHand":11,"alliance":[5],"eliminated":false}],
    phase: {"turn":1,"order":[5,4,2,3,0,1],"indexInOrder":0},
    factorySupply: 36,
    rngState: { state: 18189450024704157456n, inc: 109n },
  },
};

test.each([2, 4, 6])("setupGame output is deep-equal to the golden snapshot (%i players)", (n) => {
  expect(setupGame(seed(1n), board, n, defaultConfig())).toEqual({
    board,
    bases: EXPECTED_SETUP[n]!.bases,
    factories: [],
    players: EXPECTED_SETUP[n]!.players,
    phase: EXPECTED_SETUP[n]!.phase,
    factorySupply: EXPECTED_SETUP[n]!.factorySupply,
    config: defaultConfig(),
    rngState: EXPECTED_SETUP[n]!.rngState,
  });
});

test("mixed setup: a human taking another seat's ideal hex still completes legally", () => {
  let s = setupPhaseState(seed(1n), board, 4, defaultConfig());
  const stolen = representativeFirstBase(s, 1);
  s = placeFirstBase(s, 0, stolen);
  for (let i = 1; i < 4; i++) {
    const p = s.phase.order[s.phase.indexInOrder]!;
    s = placeFirstBase(s, p, representativeFirstBase(s, p));
  }
  expect(s.phase.turn).toBe(1);
  expect(s.bases).toHaveLength(4);
  expect(new Set(s.bases.map((b) => key(b.hex))).size).toBe(4);
});

test("placeFirstBase: only the current placer, only an unoccupied outer-ring hex", () => {
  const s0 = setupPhaseState(seed(1n), board, 4, defaultConfig());
  expect(s0.phase.turn).toBe(0);
  const validOuter = representativeFirstBase(s0, 0);
  const interior = board.hexes.find((h) => ringDepthFromEdge(h, board.hexes) !== 0)!;
  expect(() => placeFirstBase(s0, 1, validOuter)).toThrow(/not this player/i);
  expect(() => placeFirstBase(s0, 0, interior)).toThrow(/outermost-ring/i);
  const s1 = placeFirstBase(s0, 0, validOuter);
  expect(() => placeFirstBase(s1, 1, validOuter)).toThrow(/occupied/i);
});

test("placing the last first base transitions to turn 1 with a drawn order", () => {
  let s = setupPhaseState(seed(1n), board, 4, defaultConfig());
  for (let i = 0; i < 4; i++) {
    const p = s.phase.order[s.phase.indexInOrder]!;
    s = placeFirstBase(s, p, representativeFirstBase(s, p));
  }
  expect(s.phase.turn).toBe(1);
  expect(s.phase.indexInOrder).toBe(0);
  expect(s.bases).toHaveLength(4);
});

test("legalFirstBaseHexes lists exactly the unoccupied outer-ring hexes", () => {
  const s0 = setupPhaseState(seed(1n), board, 4, defaultConfig());
  const got = legalFirstBaseHexes(s0).map(key).sort();
  const want = board.hexes.filter((h) => ringDepthFromEdge(h, board.hexes) === 0).map(key).sort();
  expect(got).toEqual(want);
});

test("placeFirstBase rejects a hex that is not on the board", () => {
  const s0 = setupPhaseState(seed(1n), board, 4, defaultConfig());
  const offBoard = { x: 999, y: -999, z: 0 }; // off-board; on-board check must fire before ring-depth geometry
  expect(() => placeFirstBase(s0, 0, offBoard)).toThrow(/not on the board/i);
});

test("placeFirstBase rejects placement outside the setup phase (turn !== 0)", () => {
  // A completed setup (turn 1) is no longer in the placement phase.
  const played = setupGame(seed(1n), board, 4, defaultConfig());
  expect(played.phase.turn).toBe(1);
  const outer = legalFirstBaseHexes(setupPhaseState(seed(1n), board, 4, defaultConfig()))[0]!;
  expect(() => placeFirstBase(played, played.phase.order[0]!, outer)).toThrow(/not in setup phase/i);
});

test("advanceRound rejects a setup-phase (turn 0) state", () => {
  const s = setupPhaseState(seed(1n), board, 4, defaultConfig());
  expect(() => advanceRound(s)).toThrow(/setup phase/i);
});
