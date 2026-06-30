// ABOUTME: Golden parity/determinism guard for runMcts — pins the FULL rootStats (visit counts + per-player value vectors) for a battery of fixed (fixture × board × seed) tuples.
// ABOUTME: The correctness oracle for the MCTS hot-path perf work: any pure-speed change MUST leave runMcts's rootStats bit-identical, so this test must stay green across each fix.

import { describe, expect, it } from "vitest";
import { runMcts, defaultMctsCoreParams, actionKey, type MctsCoreParams } from "../../src/agent/mcts";
import { seed } from "../../src/rng/pcg";
import { defaultConfig } from "../../src/engine/config";
import { status } from "../../src/engine/status";
import { legalActions } from "../../src/engine/legal";
import { mkState } from "../helpers/state";
import type { GameState } from "../../src/engine/types";

const hex = (x: number, y: number, z: number) => ({ x, y, z });

// The MCTS hot path lives in EXPANSION (samplePolicy → sampleBuild → scoreMove →
// control). To exercise it the root state MUST be non-terminal AND offer real
// legal builds so progressive widening actually runs the per-candidate scoring
// loop. We raise victoryThreshold so a contested mid-game does not evaluate as a
// born-terminal leaf (which would make the root a no-edge leaf and skip
// expansion entirely).
const cfg = () => ({ ...defaultConfig(), victoryThreshold: 40 });

// Fixture A — three radiating p0 bases around two iron, p1 a small radiating
// cluster. Build-rich AND attack-legal: exercises both the chance-node combat
// path and deep build expansion.
const fixtureA = (board: number): GameState =>
  mkState({
    board,
    basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)],
    basesP1: [hex(0, 4, -4), hex(-2, 6, -4), hex(2, 2, -4)],
    iron: [hex(5, -5, 0), hex(6, -6, 0)],
    config: cfg(),
  });

// Fixture B — a younger position (p0 two bases, p1 one) sitting on three iron.
// The root opens a broad single-piece base-build candidate set, so its rootStats
// pin the full per-edge visit/value distribution (a sharper oracle than a
// single-edge root).
const fixtureB = (board: number): GameState =>
  mkState({
    board,
    basesP0: [hex(0, 0, 0), hex(3, -3, 0)],
    basesP1: [hex(-2, 4, -2)],
    iron: [hex(1, -1, 0), hex(2, -2, 0), hex(-1, 3, -2)],
    config: cfg(),
  });

const fixtures: Record<"A" | "B", (b: number) => GameState> = { A: fixtureA, B: fixtureB };

// Modest iteration budget keeps the battery fast while still driving expansion.
const params = (): MctsCoreParams => ({ ...defaultMctsCoreParams(), iterations: 40, maxDepth: 8 });

interface GoldenEdge {
  k: string; // canonical actionKey
  v: number; // visits (edge.childN)
  val: number[]; // accumulated per-player valueVec
}
interface GoldenTuple {
  fixture: "A" | "B";
  board: number;
  seed: bigint;
  stats: GoldenEdge[];
}

// Golden snapshot captured on the UNMODIFIED hot path (greedy/scoreMove/control
// pre-optimization). Each value vector is pinned to full precision so a math
// change — not just a reordering — perturbs at least one entry. Regenerate ONLY
// if the search's intended behavior changes (never to paper over a perf fix that
// shifted these numbers — that would mean the fix changed behavior).
const GOLDEN: GoldenTuple[] = [
  {
    fixture: "A", board: 96, seed: 1n,
    stats: [
      { k: "attack:2,2,-4>0,0,0,2,-2,0,4,-4,0>0,4,-4", v: 40, val: [9, 0] },
    ],
  },
  {
    fixture: "A", board: 96, seed: 7n,
    stats: [
      { k: "attack:2,2,-4>0,0,0,2,-2,0,4,-4,0>0,4,-4", v: 40, val: [12, 0] },
    ],
  },
  {
    fixture: "A", board: 96, seed: 1234n,
    stats: [
      { k: "attack:2,2,-4>0,0,0,2,-2,0,4,-4,0>0,4,-4", v: 40, val: [10, 0] },
    ],
  },
  {
    fixture: "A", board: 220, seed: 1n,
    stats: [
      { k: "attack:2,2,-4>0,0,0,2,-2,0,4,-4,0>0,4,-4", v: 40, val: [9, 0] },
    ],
  },
  {
    fixture: "A", board: 220, seed: 7n,
    stats: [
      { k: "attack:2,2,-4>0,0,0,2,-2,0,4,-4,0>0,4,-4", v: 40, val: [12, 0] },
    ],
  },
  {
    fixture: "A", board: 220, seed: 1234n,
    stats: [
      { k: "attack:2,2,-4>0,0,0,2,-2,0,4,-4,0>0,4,-4", v: 40, val: [10, 0] },
    ],
  },
  {
    fixture: "B", board: 96, seed: 1n,
    stats: [
      { k: "build:base@-1,5,-4", v: 40, val: [38.999934302340804, 1.0000656976591875] },
      { k: "build:base@-5,1,4", v: 0, val: [0, 0] },
      { k: "build:base@0,-4,4", v: 0, val: [0, 0] },
      { k: "build:base@0,4,-4", v: 0, val: [0, 0] },
      { k: "build:base@-2,-2,4", v: 0, val: [0, 0] },
      { k: "build:base@-4,0,4", v: 0, val: [0, 0] },
      { k: "build:base@3,1,-4", v: 0, val: [0, 0] },
      { k: "build:base@2,2,-4", v: 0, val: [0, 0] },
      { k: "build:base@-1,-3,4", v: 0, val: [0, 0] },
      { k: "build:base@6,-3,-3", v: 0, val: [0, 0] },
      { k: "build:base@1,3,-4", v: 0, val: [0, 0] },
      { k: "build:base@5,-1,-4", v: 0, val: [0, 0] },
      { k: "build:base@1,-5,4", v: 0, val: [0, 0] },
    ],
  },
  {
    fixture: "B", board: 96, seed: 7n,
    stats: [
      { k: "build:base@5,-1,-4", v: 40, val: [38.99999989688815, 1.0000001031118526] },
      { k: "build:base@-2,-2,4", v: 0, val: [0, 0] },
      { k: "build:base@-4,0,4", v: 0, val: [0, 0] },
      { k: "build:base@-1,5,-4", v: 0, val: [0, 0] },
      { k: "build:base@-3,-1,4", v: 0, val: [0, 0] },
      { k: "build:base@4,0,-4", v: 0, val: [0, 0] },
      { k: "build:base@0,-4,4", v: 0, val: [0, 0] },
      { k: "build:base@-5,1,4", v: 0, val: [0, 0] },
      { k: "build:base@1,3,-4", v: 0, val: [0, 0] },
      { k: "build:base@0,4,-4", v: 0, val: [0, 0] },
      { k: "build:base@2,2,-4", v: 0, val: [0, 0] },
      { k: "build:base@-1,-3,4", v: 0, val: [0, 0] },
      { k: "build:base@3,1,-4", v: 0, val: [0, 0] },
    ],
  },
  {
    fixture: "B", board: 96, seed: 1234n,
    stats: [
      { k: "build:base@4,0,-4", v: 40, val: [39.99999864202754, 0.000001357972461964599] },
      { k: "build:base@3,1,-4", v: 0, val: [0, 0] },
      { k: "build:base@-4,0,4", v: 0, val: [0, 0] },
      { k: "build:base@1,3,-4", v: 0, val: [0, 0] },
      { k: "build:base@0,4,-4", v: 0, val: [0, 0] },
      { k: "build:base@3,0,-3", v: 0, val: [0, 0] },
      { k: "build:base@-1,-3,4", v: 0, val: [0, 0] },
      { k: "build:base@-3,-1,4", v: 0, val: [0, 0] },
      { k: "build:base@-5,1,4", v: 0, val: [0, 0] },
      { k: "build:base@5,-1,-4", v: 0, val: [0, 0] },
      { k: "build:base@-2,-2,4", v: 0, val: [0, 0] },
      { k: "build:base@2,2,-4", v: 0, val: [0, 0] },
      { k: "build:base@1,-5,4", v: 0, val: [0, 0] },
    ],
  },
  {
    fixture: "B", board: 220, seed: 1n,
    stats: [
      { k: "build:base@0,5,-5", v: 40, val: [39.999962551395875, 0.00003744860411975485] },
      { k: "build:base@-4,-1,5", v: 0, val: [0, 0] },
      { k: "build:base@1,-6,5", v: 0, val: [0, 0] },
      { k: "build:base@-5,0,5", v: 0, val: [0, 0] },
      { k: "build:base@3,2,-5", v: 0, val: [0, 0] },
      { k: "build:base@8,-3,-5", v: 0, val: [0, 0] },
      { k: "build:base@1,4,-5", v: 0, val: [0, 0] },
      { k: "build:base@-1,-4,5", v: 0, val: [0, 0] },
      { k: "build:base@6,-1,-5", v: 0, val: [0, 0] },
      { k: "build:base@7,-2,-5", v: 0, val: [0, 0] },
      { k: "build:base@-2,-3,5", v: 0, val: [0, 0] },
      { k: "build:base@3,-8,5", v: 0, val: [0, 0] },
      { k: "build:base@5,0,-5", v: 0, val: [0, 0] },
    ],
  },
  {
    fixture: "B", board: 220, seed: 7n,
    stats: [
      { k: "build:base@7,-2,-5", v: 40, val: [40, 0] },
      { k: "build:base@-2,-3,5", v: 0, val: [0, 0] },
      { k: "build:base@-1,-4,5", v: 0, val: [0, 0] },
      { k: "build:base@1,-6,5", v: 0, val: [0, 0] },
      { k: "build:base@2,-7,5", v: 0, val: [0, 0] },
      { k: "build:base@3,2,-5", v: 0, val: [0, 0] },
      { k: "build:base@-3,-2,5", v: 0, val: [0, 0] },
      { k: "build:base@-5,0,5", v: 0, val: [0, 0] },
      { k: "build:base@8,-3,-5", v: 0, val: [0, 0] },
      { k: "build:base@2,3,-5", v: 0, val: [0, 0] },
      { k: "build:base@6,-1,-5", v: 0, val: [0, 0] },
      { k: "build:base@3,-8,5", v: 0, val: [0, 0] },
      { k: "build:base@0,-5,5", v: 0, val: [0, 0] },
    ],
  },
  {
    fixture: "B", board: 220, seed: 1234n,
    stats: [
      { k: "build:base@6,-1,-5", v: 40, val: [40, 2.8206004062003345e-34] },
      { k: "build:base@5,0,-5", v: 0, val: [0, 0] },
      { k: "build:base@2,3,-5", v: 0, val: [0, 0] },
      { k: "build:base@7,-2,-5", v: 0, val: [0, 0] },
      { k: "build:base@1,3,-4", v: 0, val: [0, 0] },
      { k: "build:base@8,-3,-5", v: 0, val: [0, 0] },
      { k: "build:base@-3,-2,5", v: 0, val: [0, 0] },
      { k: "build:base@-4,-1,5", v: 0, val: [0, 0] },
      { k: "build:base@2,2,-4", v: 0, val: [0, 0] },
      { k: "build:base@0,-5,5", v: 0, val: [0, 0] },
      { k: "build:base@4,1,-5", v: 0, val: [0, 0] },
      { k: "build:base@3,2,-5", v: 0, val: [0, 0] },
      { k: "build:base@3,-8,5", v: 0, val: [0, 0] },
    ],
  },
];

describe("runMcts — fixtures actually exercise the expansion hot path", () => {
  // Guard the guard: a born-terminal or build-empty root would make this parity
  // test vacuous (it would pin a no-edge leaf, never running expansion). Assert
  // every fixture is non-terminal AND offers real legal builds.
  it("every fixture is non-terminal and offers legal builds", () => {
    for (const board of [96, 220]) {
      for (const make of [fixtureA, fixtureB]) {
        const st = make(board);
        expect(status(st).kind).toBe("ongoing");
        const builds = legalActions(st).filter((a) => a.kind === "build").length;
        expect(builds).toBeGreaterThan(0);
      }
    }
  });
});

describe("runMcts — determinism (two runs on the same seed are bit-identical)", () => {
  for (const t of GOLDEN) {
    it(`fixture ${t.fixture} / board ${t.board} / seed ${t.seed} → identical rootStats twice`, () => {
      const r1 = runMcts(fixtures[t.fixture](t.board), 0, params(), seed(t.seed));
      const r2 = runMcts(fixtures[t.fixture](t.board), 0, params(), seed(t.seed));
      expect(r1.rootStats.map((e) => ({ k: actionKey(e.action), v: e.visits, val: e.valueVec }))).toEqual(
        r2.rootStats.map((e) => ({ k: actionKey(e.action), v: e.visits, val: e.valueVec })),
      );
    });
  }
});

describe("runMcts — golden parity (rootStats bit-identical to the captured snapshot)", () => {
  for (const t of GOLDEN) {
    it(`fixture ${t.fixture} / board ${t.board} / seed ${t.seed} → matches the golden snapshot`, () => {
      const { rootStats } = runMcts(fixtures[t.fixture](t.board), 0, params(), seed(t.seed));
      const actual = rootStats.map((e) => ({ k: actionKey(e.action), v: e.visits, val: e.valueVec }));
      const expected = t.stats.map((e) => ({ k: e.k, v: e.v, val: e.val }));
      expect(actual).toEqual(expected);
    });
  }
});
