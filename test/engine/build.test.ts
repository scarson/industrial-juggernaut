import { describe, it, expect } from "vitest";
import { hex, distance } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import {
  buildBudget,
  farthestBases,
  isLegalFactoryPlacement,
  isLegalBasePlacement,
} from "../../src/engine/build";
import { mkState } from "../helpers/state";

// All fixtures use on-board coordinates discovered for the seed-1n/size-96 board:
//   on-board:  (0,0,0) (2,-2,0) (4,-4,0) (5,-5,0) (6,-6,0) (0,4,-4) (4,0,-4)
//              (-2,2,0) (-3,3,0) (-4,4,0) (2,0,-2) (0,2,-2) (2,1,-3) (2,-1,-1)
//              (4,-1,-3) (3,-1,-2) (3,-3,0) (1,1,-2)
//   off-board: (0,5,-5) (8,-8,0)
// Any extra hex a fixture needs is unioned onto the board via mkState's
// `iron`/base arrays (per the helper contract).

describe("buildBudget", () => {
  // floor(rc/2) over a non-bootstrap fixture (>=4 bases => no bootstrap floor).
  // A 4-base non-degenerate perimeter; we vary the iron set to tune resourceCount.
  const perimeterBases = [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)];

  it("rc=2 => budget 1 (floor(2/2))", () => {
    // Two iron hexes inside the perimeter; no factories => rc=2.
    const s = mkState({ board: 96, basesP0: perimeterBases, iron: [hex(2, -2, 0), hex(2, 0, -2)] });
    expect(buildBudget(s, 0)).toBe(1);
  });

  it("rc=3 => budget 1 (floor(3/2))", () => {
    const s = mkState({
      board: 96,
      basesP0: perimeterBases,
      iron: [hex(2, -2, 0), hex(2, 0, -2), hex(1, 1, -2)],
    });
    expect(buildBudget(s, 0)).toBe(1);
  });

  it("rc=4 => budget 2 (floor(4/2))", () => {
    const s = mkState({
      board: 96,
      basesP0: perimeterBases,
      iron: [hex(2, -2, 0), hex(2, 0, -2), hex(1, 1, -2)],
      factories: [hex(2, -2, 0)],
    });
    // 3 iron + 1 factory (factory shares an iron hex; control counts both) => rc=4.
    expect(buildBudget(s, 0)).toBe(2);
  });

  it("rc=6 => budget 3 (floor(6/2))", () => {
    const s = mkState({
      board: 96,
      basesP0: perimeterBases,
      iron: [hex(2, -2, 0), hex(2, 0, -2), hex(1, 1, -2)],
      factories: [hex(2, -2, 0), hex(2, 0, -2), hex(1, 1, -2)],
    });
    // 3 iron + 3 factories => rc=6.
    expect(buildBudget(s, 0)).toBe(3);
  });

  it("non-bootstrap: 4+ bases controlling 1 iron => budget floor(1/2)=0 (no bootstrap floor)", () => {
    // rc=1, but the player has 4 bases, so the bootstrap exception does NOT apply.
    const s = mkState({ board: 96, basesP0: perimeterBases, iron: [hex(2, -2, 0)] });
    expect(buildBudget(s, 0)).toBe(0);
  });

  it("bootstrap: <4 bases, >=1 iron, 0 factories, rc s.t. floor=0 => budget 1", () => {
    // Single base controls one iron (rc=1). floor(1/2)=0, but bootstrap lifts to 1.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(2, -2, 0)] });
    expect(buildBudget(s, 0)).toBe(1);
  });

  it("bootstrap does NOT apply when the player already controls a factory", () => {
    // <4 bases and 1 iron, but a controlled factory disqualifies bootstrap.
    // rc = 1 iron + 1 factory = 2 => floor(2/2) = 1 (from the normal rule, not bootstrap).
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(2, -2, 0)],
      factories: [hex(2, 0, -2)],
    });
    expect(buildBudget(s, 0)).toBe(1);
    // And with 0 iron + 1 factory (rc=1) bootstrap must NOT fire (needs >=1 iron).
    const s2 = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      iron: [hex(6, -3, -3)], // d=6 from the base (> radius 5), not controlled
      factories: [hex(2, 0, -2)],
    });
    // controls 0 iron, 1 factory => rc=1, floor=0, bootstrap blocked (factory present & 0 iron).
    expect(buildBudget(s2, 0)).toBe(0);
  });

  it("bootstrap does NOT apply when the player controls 0 iron", () => {
    // <4 bases, 0 factories, but no controlled iron => bootstrap blocked, rc=0 => 0.
    // (6,-3,-3) is d=6 from the base (> radius 5), so it is not controlled.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], iron: [hex(6, -3, -3)] });
    expect(buildBudget(s, 0)).toBe(0);
  });
});

describe("farthestBases", () => {
  it("returns all bases tied for max distance from the oldest base (R4)", () => {
    // Oldest base (min order) is (0,0,0). (4,-4,0) and (0,4,-4) are both d=4 (tied
    // farthest); (2,-2,0) is d=2.
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0), hex(0, 4, -4)],
    });
    const result = farthestBases(s, 0);
    const keys = result.map((b) => `${b.hex.x},${b.hex.y},${b.hex.z}`).sort();
    expect(keys).toEqual(["0,4,-4", "4,-4,0"]);
    // sanity: both are distance 4 from the oldest base.
    for (const b of result) expect(distance(b.hex, hex(0, 0, 0))).toBe(4);
  });

  it("returns the single farthest base when there is no tie", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)] });
    const result = farthestBases(s, 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.hex).toEqual(hex(4, -4, 0));
  });

  it("returns the first/oldest base when the player has only that base", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)] });
    const result = farthestBases(s, 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.hex).toEqual(hex(0, 0, 0));
  });
});

describe("isLegalFactoryPlacement", () => {
  // Oldest base (0,0,0); farthest base (4,-4,0) at d=4. Only iron hex is (5,-5,0).
  const factoryFixture = () =>
    mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)],
      iron: [hex(5, -5, 0)],
    });

  it("legal on an empty non-iron hex within placeRange of the farthest base", () => {
    // (6,-6,0) is d=2 from the farthest base (4,-4,0); empty and not iron.
    expect(isLegalFactoryPlacement(factoryFixture(), 0, hex(6, -6, 0))).toBe(true);
  });

  it("illegal on an iron hex", () => {
    // (5,-5,0) is iron (and within range) => illegal.
    expect(isLegalFactoryPlacement(factoryFixture(), 0, hex(5, -5, 0))).toBe(false);
  });

  it("illegal on a hex occupied by a base", () => {
    // (2,-2,0) holds a friendly base => occupied => illegal.
    expect(isLegalFactoryPlacement(factoryFixture(), 0, hex(2, -2, 0))).toBe(false);
  });

  it("illegal on a hex occupied by a factory", () => {
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)],
      iron: [hex(5, -5, 0)],
      factories: [hex(6, -6, 0)],
    });
    expect(isLegalFactoryPlacement(s, 0, hex(6, -6, 0))).toBe(false);
  });

  it("illegal when too far from the farthest base", () => {
    // (-4,4,0) is d=8 from the farthest base (4,-4,0) > placeRange 5.
    expect(isLegalFactoryPlacement(factoryFixture(), 0, hex(-4, 4, 0))).toBe(false);
  });

  it("illegal when off the board", () => {
    // (8,-8,0) is off the board.
    expect(isLegalFactoryPlacement(factoryFixture(), 0, hex(8, -8, 0))).toBe(false);
  });

  it("illegal when factorySupply is 0", () => {
    const cfg = { ...defaultConfig(), factorySupply: 0 };
    const s = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)],
      iron: [hex(5, -5, 0)],
      config: cfg,
    });
    expect(s.factorySupply).toBe(0);
    expect(isLegalFactoryPlacement(s, 0, hex(6, -6, 0))).toBe(false);
  });
});

describe("isLegalBasePlacement — outside own perimeter", () => {
  // Friendly p0 has two bases (radiating, no perimeter): oldest (-2,2,0) and (4,-4,0).
  // Opponent p1 has a 4-base non-degenerate hull blocking part of the board.
  const oppBases = [hex(2, 1, -3), hex(2, -1, -1), hex(4, -1, -3), hex(4, 1, -5)];
  const friendly = [hex(-2, 2, 0), hex(4, -4, 0)];

  it("legal when within range and it sees two friendly bases unobstructed (no opponent perimeter)", () => {
    // Opponent has only 1 base => no perimeter => empty blocker set.
    // (2,-2,0) is within placeRange of (4,-4,0) (d=2) and sees both friendly bases.
    const s = mkState({ board: 96, basesP0: friendly, basesP1: [hex(2, 1, -3)] });
    expect(isLegalBasePlacement(s, 0, hex(2, -2, 0))).toBe(true);
  });

  it("radiating phase (<3 bases): legal by proximity even when it sees only one friendly base", () => {
    // p0 has 2 bases (placing its 3rd = radiating phase). The opponent perimeter
    // blocks the segment (0,2,-2)->(4,-4,0), so (0,2,-2) sees only ONE friendly
    // base (-2,2,0) at d=2. The triangle rule applies to perimeter-establishing
    // placements (>=3 existing bases), NOT the radiating phase, so proximity +
    // not-in-opponent-perimeter is sufficient => legal. (Corrected 2026-05-27:
    // previously this asserted `false`, encoding the bug that froze players at 1
    // base — see rules v10 §"Radiating Bases" / §"Placing Bases".)
    const s = mkState({ board: 96, basesP0: friendly, basesP1: oppBases });
    expect(isLegalBasePlacement(s, 0, hex(0, 2, -2))).toBe(true);
  });

  it("illegal when inside an opponent's perimeter", () => {
    // (2,0,-2) lies inside the opponent's hull interior => illegal regardless of visibility.
    const s = mkState({ board: 96, basesP0: friendly, basesP1: oppBases });
    expect(isLegalBasePlacement(s, 0, hex(2, 0, -2))).toBe(false);
  });

  it("illegal when too far from every friendly base", () => {
    // (-4,4,0): d to (-2,2,0) is 4? actually compute below — keep it > placeRange of both.
    const s = mkState({ board: 96, basesP0: [hex(4, -4, 0), hex(5, -5, 0)], basesP1: [hex(2, 1, -3)] });
    // (-4,4,0) is far from both (4,-4,0) and (5,-5,0).
    expect(isLegalBasePlacement(s, 0, hex(-4, 4, 0))).toBe(false);
  });

  it("illegal on an occupied hex", () => {
    const s = mkState({ board: 96, basesP0: friendly, basesP1: [hex(2, 1, -3)] });
    // (4,-4,0) holds a friendly base.
    expect(isLegalBasePlacement(s, 0, hex(4, -4, 0))).toBe(false);
  });

  it("illegal when off the board", () => {
    const s = mkState({ board: 96, basesP0: friendly, basesP1: [hex(2, 1, -3)] });
    expect(isLegalBasePlacement(s, 0, hex(8, -8, 0))).toBe(false);
  });
});

describe("isLegalBasePlacement — radiating phase (<3 existing bases)", () => {
  // Rules v10 §"Radiating Bases": with 1/2/3 bases a player has NO perimeter,
  // so a 2nd/3rd base needs only proximity to a friendly base + not inside an
  // opponent perimeter. The two-visible-bases triangle rule governs perimeter
  // establishment/extension (4th+ base), not the radiating phase.

  it("a 1-base player CAN place a 2nd base by proximity (the headline regression)", () => {
    // p0 has a single base at (0,0,0); opponent has 1 base (no perimeter).
    // (2,-2,0) is on-board, empty, d=2 from the base, not in any opponent perimeter.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(4, 1, -5)] });
    expect(isLegalBasePlacement(s, 0, hex(2, -2, 0))).toBe(true);
  });

  it("a 2-base player CAN place a 3rd base by proximity (no triangle required)", () => {
    // p0 has 2 bases; (2,0,-2) is d=2 from (0,0,0), empty, not in an opponent perimeter.
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0), hex(4, -4, 0)], basesP1: [hex(4, 1, -5)] });
    expect(isLegalBasePlacement(s, 0, hex(2, 0, -2))).toBe(true);
  });

  it("radiating 2nd base still illegal when out of range of every friendly base", () => {
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [hex(4, 1, -5)] });
    // (6,-6,0) is d=6 from (0,0,0) > placeRange 5.
    expect(isLegalBasePlacement(s, 0, hex(6, -6, 0))).toBe(false);
  });

  it("radiating 2nd base still illegal inside an opponent perimeter", () => {
    // Opponent has a 4-base hull; (2,0,-2) lies inside it.
    const oppBases = [hex(2, 1, -3), hex(2, -1, -1), hex(4, -1, -3), hex(4, 1, -5)];
    const s = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: oppBases });
    expect(isLegalBasePlacement(s, 0, hex(2, 0, -2))).toBe(false);
  });
});

describe("isLegalBasePlacement — perimeter establishment (>=3 existing bases, placing 4th+)", () => {
  // Rules v10 §"Placing Bases": the 4th+ base extends the perimeter, so it MUST
  // form an unobstructed triangle with two distinct visible friendly bases.
  // p0 has 3 bases (placing its 4th); opponent has a 4-base hull that blocks
  // some sightlines.
  const three = [hex(-2, 2, 0), hex(4, -4, 0), hex(0, 4, -4)];
  const oppBases = [hex(2, 1, -3), hex(2, -1, -1), hex(4, -1, -3), hex(4, 1, -5)];

  it("4th base illegal when it sees only ONE friendly base", () => {
    // (4,-2,-2): in range (d=2 from (4,-4,0)), not in opponent hull, but the
    // opponent perimeter blocks the lines to the other two bases => visibleCount 1.
    const s = mkState({ board: 96, basesP0: three, basesP1: oppBases });
    expect(isLegalBasePlacement(s, 0, hex(4, -2, -2))).toBe(false);
  });

  it("4th base legal when it sees TWO friendly bases unobstructed", () => {
    // (0,3,-3): in range (d=1 from (0,4,-4)), not in opponent hull, sees two
    // friendly bases ((-2,2,0) and (0,4,-4)) => triangle formed => legal.
    const s = mkState({ board: 96, basesP0: three, basesP1: oppBases });
    expect(isLegalBasePlacement(s, 0, hex(0, 3, -3))).toBe(true);
  });
});

describe("isLegalBasePlacement — bases-in-hand gate", () => {
  // A geometrically-legal interior placement: p0 has a 4-base non-degenerate
  // perimeter, and (2,-2,0) is an empty interior hex (legal when bases remain).
  const perimeterBases = [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)];
  const fixture = () => mkState({ board: 96, basesP0: perimeterBases });

  it("illegal when the acting player has basesInHand === 0 (cannot place a base you don't have)", () => {
    const s = fixture();
    // Maxed out: all bases on the board, none in hand.
    s.players[0]!.basesInHand = 0;
    expect(isLegalBasePlacement(s, 0, hex(2, -2, 0))).toBe(false);
  });

  it("legal for the same fixture when basesInHand > 0 (only the bases-in-hand gate changed)", () => {
    const s = fixture();
    s.players[0]!.basesInHand = 1;
    expect(isLegalBasePlacement(s, 0, hex(2, -2, 0))).toBe(true);
  });

  it("factory placement is unaffected by basesInHand === 0 (factories come from factorySupply)", () => {
    // (6,-6,0) is d2 from the farthest base (4,-4,0): empty, non-iron, in range,
    // and factorySupply > 0 by default. basesInHand has no bearing on factories.
    const s = fixture();
    s.players[0]!.basesInHand = 0;
    expect(isLegalFactoryPlacement(s, 0, hex(6, -6, 0))).toBe(true);
  });
});

describe("isLegalBasePlacement — inside own perimeter", () => {
  // p0 has a 4-base non-degenerate perimeter.
  const perimeterBases = [hex(0, 0, 0), hex(4, -4, 0), hex(4, 0, -4), hex(0, 4, -4)];

  it("legal on an empty interior hex of own perimeter", () => {
    const s = mkState({ board: 96, basesP0: perimeterBases });
    // (2,-2,0) is interior to the hull and empty.
    expect(isLegalBasePlacement(s, 0, hex(2, -2, 0))).toBe(true);
  });

  it("illegal on an occupied interior hex (a hull vertex base)", () => {
    const s = mkState({ board: 96, basesP0: perimeterBases });
    // (0,0,0) is a base (occupied) — even inside the perimeter, occupied is illegal.
    expect(isLegalBasePlacement(s, 0, hex(0, 0, 0))).toBe(false);
  });
});
