import { describe, it, expect } from "vitest";
import { hex, key, neighbors } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import {
  opponentPerimeterBlockers,
  strandedBases,
  removeEncircledStrandedBases,
} from "../../src/engine/stranded";

// ---------------------------------------------------------------------------
// Fixture geometry (seed-1n / size-96 board; all coords below are on-board
// interior hexes, verified empirically).
//
// DETECTION fixture:
//   Opponent (p1) holds a small 4-base hull (a vertical "strip") spanning the
//   middle of the board:
//       (0,2,-2) (0,-1,1) (1,1,-2) (1,-2,1)   hullArea ~ 7.79 > 0
//   Player 0 holds four bases:
//       S  = (4,-1,-3)  top-right, ABOVE the strip
//       f1 = (-1,4,-3)  top-left  (its line to S clears the strip top)
//       f2 = (-4,3,1)   left
//       f3 = (-4,2,2)   left
//   Visibility graph (edge iff NOT blocked by the opponent perimeter):
//       S sees only f1            -> degree 1  -> STRANDED
//       f1 sees S, f2, f3         -> degree 3
//       f2 sees f1, f3            -> degree 2
//       f3 sees f1, f2            -> degree 2
//
// RESCUE: add p0 base R = (4,0,-4) on S's (right) side; S<->R is unblocked, so
//   S reaches degree 2 (rescued). R itself sees S and F1 -> degree 2 (not newly
//   stranded), so the player ends up with zero stranded bases.
//
// ENCIRCLEMENT fixture:
//   E = (0,0,0); its six neighbors are all held by opponent p1:
//       (1,-1,0)(1,0,-1)(0,1,-1)(-1,1,0)(-1,0,1)(0,-1,1)  hullArea ~ 7.79
//   p0 also holds a=(4,-4,0), b=(4,0,-4) far to the right.
//   E is blocked from both a and b (it sits inside the opponent ring) -> degree 0
//     -> stranded; all six neighbors opponent-held -> fully encircled.
//   a, b see each other; both have empty (non-opponent) neighbors -> NOT encircled.
// ---------------------------------------------------------------------------

const OPP_STRIP = [hex(0, 2, -2), hex(0, -1, 1), hex(1, 1, -2), hex(1, -2, 1)];
const S = hex(4, -1, -3);
const F1 = hex(-1, 4, -3);
const F2 = hex(-4, 3, 1);
const F3 = hex(-4, 2, 2);

function detectionState() {
  return mkState({
    board: 96,
    basesP0: [S, F1, F2, F3],
    basesP1: OPP_STRIP,
  });
}

describe("opponentPerimeterBlockers", () => {
  it("includes board hexes inside a valid (>=4 base, positive-area) opponent hull", () => {
    const s = detectionState();
    const blockers = opponentPerimeterBlockers(s, 0);
    // The opponent strip vertices are inside-or-on their own hull.
    for (const h of OPP_STRIP) expect(blockers.has(key(h))).toBe(true);
    // A clearly-outside friendly hex is not a blocker.
    expect(blockers.has(key(F2))).toBe(false);
  });

  it("ignores opponents with < 4 bases (no valid perimeter)", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(2, -2, 0), hex(0, 2, -2)] });
    expect(opponentPerimeterBlockers(s, 0).size).toBe(0);
  });

  it("ignores opponents whose hull is degenerate (zero area / colinear)", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      // four colinear bases -> hullArea 0 -> not a valid perimeter
      basesP1: [hex(-2, 2, 0), hex(-1, 1, 0), hex(1, -1, 0), hex(2, -2, 0)],
    });
    expect(opponentPerimeterBlockers(s, 0).size).toBe(0);
  });

  it("excludes allied players (only true opponents block)", () => {
    const s = detectionState();
    // Ally p1 to p0 (mutual). Now p1 is NOT an opponent -> no blockers.
    s.players[0]!.alliance = [0, 1];
    s.players[1]!.alliance = [0, 1];
    expect(opponentPerimeterBlockers(s, 0).size).toBe(0);
  });
});

describe("strandedBases", () => {
  it("flags the one base visible to fewer than two friendly bases", () => {
    const s = detectionState();
    const stranded = strandedBases(s, 0);
    expect(stranded.map((b) => key(b.hex))).toEqual([key(S)]);
  });

  it("returns [] when all bases mutually see each other (no opponent blocking)", () => {
    // Same four p0 bases, but no opponent at all -> full visibility -> none stranded.
    const s = mkState({ board: 96, basesP0: [S, F1, F2, F3] });
    expect(strandedBases(s, 0)).toEqual([]);
  });

  it("returns [] for a player with fewer than 3 bases (perimeter moot)", () => {
    const one = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: OPP_STRIP });
    expect(strandedBases(one, 0)).toEqual([]);
    const two = mkState({ board: 96, basesP0: [S, F2], basesP1: OPP_STRIP });
    expect(strandedBases(two, 0)).toEqual([]);
  });

  it("rescue: adding a friendly base that grants 2-visibility un-strands the base", () => {
    const before = detectionState();
    expect(strandedBases(before, 0).map((b) => key(b.hex))).toEqual([key(S)]);

    // Add R on S's side; S now sees R as well as F1 -> degree 2 -> rescued.
    const after = mkState({
      board: 96,
      basesP0: [S, F1, F2, F3, hex(4, 0, -4)],
      basesP1: OPP_STRIP,
    });
    expect(strandedBases(after, 0)).toEqual([]);
  });

  it("applies the degree-<2 rule for exactly 3 bases", () => {
    // E=(0,0,0) encircled-and-blocked; a,b to the right see each other but not E.
    // E has degree 0 (< 2) -> stranded even at exactly 3 bases.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4)],
      basesP1: neighbors(hex(0, 0, 0)),
    });
    const stranded = strandedBases(s, 0).map((b) => key(b.hex));
    expect(stranded).toContain(key(hex(0, 0, 0)));
  });
});

describe("removeEncircledStrandedBases", () => {
  function encircledState() {
    return mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4)],
      basesP1: neighbors(hex(0, 0, 0)),
    });
  }

  it("removes a stranded base whose six neighbors are all opponent-held, emitting baseDestroyed", () => {
    const s = encircledState();
    const { state, events } = removeEncircledStrandedBases(s);

    // E removed from play.
    const e = key(hex(0, 0, 0));
    expect(state.bases.some((b) => b.owner === 0 && key(b.hex) === e)).toBe(false);

    // Exactly one baseDestroyed event, for E owned by p0.
    const destroyed = events.filter((ev) => ev.kind === "baseDestroyed");
    expect(destroyed).toEqual([{ kind: "baseDestroyed", hex: hex(0, 0, 0), owner: 0 }]);
  });

  it("does NOT remove a stranded base that has an empty/non-opponent neighbor", () => {
    const s = encircledState();
    const { state, events } = removeEncircledStrandedBases(s);
    // a and b are stranded but not encircled (empty neighbors) -> still present.
    expect(state.bases.some((b) => b.owner === 0 && key(b.hex) === key(hex(4, -4, 0)))).toBe(true);
    expect(state.bases.some((b) => b.owner === 0 && key(b.hex) === key(hex(4, 0, -4)))).toBe(true);
    // Only E was destroyed.
    expect(events.filter((ev) => ev.kind === "baseDestroyed").length).toBe(1);
  });

  it("does not change basesInHand for the destroyed base's owner", () => {
    const s = encircledState();
    const handBefore = s.players[0]!.basesInHand;
    const { state } = removeEncircledStrandedBases(s);
    expect(state.players[0]!.basesInHand).toBe(handBefore);
  });

  it("returns no events when nothing qualifies", () => {
    // No opponent: nobody is stranded, nothing encircled.
    const s = mkState({ board: 96, basesP0: [S, F1, F2, F3] });
    const { state, events } = removeEncircledStrandedBases(s);
    expect(events).toEqual([]);
    expect(state.bases.length).toBe(s.bases.length);
  });

  it("is pure: the input state is not mutated", () => {
    const s = encircledState();
    const basesBefore = s.bases.length;
    const snapshot = s.bases.map((b) => key(b.hex)).sort();
    removeEncircledStrandedBases(s);
    expect(s.bases.length).toBe(basesBefore);
    expect(s.bases.map((b) => key(b.hex)).sort()).toEqual(snapshot);
  });
});
