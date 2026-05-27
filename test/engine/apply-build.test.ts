import { describe, it, expect } from "vitest";
import { hex, key } from "../../src/geometry/cube";
import type { Action, GameState } from "../../src/engine/types";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";

// On-board coordinates for the seed-1n/size-96 board (see test/engine/build.test.ts
// header). Fixtures below reuse those known-good coords; any extra hex is unioned
// onto the board via mkState's `iron`/base arrays.

// A 3-base radiating fixture for p0: oldest (0,0,0), farthest (4,-4,0) at d=4,
// with one iron hex at (5,-5,0). Factory placement targets are within placeRange
// of the farthest base and are empty, non-iron, on-board.
const factoryFixture = (): GameState =>
  mkState({
    board: 96,
    basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)],
    iron: [hex(5, -5, 0)],
  });

// Same geometry as factoryFixture but with 4 controlled iron hexes so the
// build budget is floor(4/2) = 2 (enough for a 2-factory build). The iron hexes
// are all within radius 5 of a base and are distinct from the placement targets.
const multiFactoryFixture = (): GameState =>
  mkState({
    board: 96,
    basesP0: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)],
    iron: [hex(5, -5, 0), hex(2, 0, -2), hex(0, 2, -2), hex(1, 1, -2)],
  });

describe("applyAction — build: factories", () => {
  it("placing N factories decrements factorySupply by N and appends N Factory pieces", () => {
    const s = multiFactoryFixture();
    const supplyBefore = s.factorySupply;
    const factoriesBefore = s.factories.length;
    const action: Action = {
      kind: "build",
      pieces: [
        { type: "factory", hex: hex(6, -6, 0) }, // d=2 from farthest (4,-4,0)
        { type: "factory", hex: hex(3, -3, 0) }, // d=1 from farthest (4,-4,0)
      ],
    };
    const { state, events } = applyAction(s, action);

    expect(state.factorySupply).toBe(supplyBefore - 2);
    expect(state.factories).toHaveLength(factoriesBefore + 2);

    const fkeys = state.factories.map((f) => key(f.hex));
    expect(fkeys).toContain(key(hex(6, -6, 0)));
    expect(fkeys).toContain(key(hex(3, -3, 0)));

    // Two "placed" factory events, in order, owned by the acting player (p0).
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: "placed", piece: "factory", hex: hex(6, -6, 0), owner: 0 });
    expect(events[1]).toEqual({ kind: "placed", piece: "factory", hex: hex(3, -3, 0), owner: 0 });
  });

  it("placing a single factory emits one placed event and appends one Factory", () => {
    const s = factoryFixture();
    const action: Action = { kind: "build", pieces: [{ type: "factory", hex: hex(6, -6, 0) }] };
    const { state, events } = applyAction(s, action);
    expect(state.factorySupply).toBe(s.factorySupply - 1);
    expect(state.factories).toHaveLength(s.factories.length + 1);
    expect(events).toEqual([{ kind: "placed", piece: "factory", hex: hex(6, -6, 0), owner: 0 }]);
  });
});

describe("applyAction — build: bases", () => {
  // p0 radiating with two friendly bases; opponent p1 has only one base => no
  // opponent perimeter. (2,-2,0) is within placeRange of (4,-4,0) (d=2) and sees
  // both friendly bases unobstructed => legal base placement.
  // p0 controls 4 iron hexes (within radius 5 of a friendly base) => build budget
  // floor(4/2) = 2, enough to place up to two bases.
  const baseFixture = (): GameState =>
    mkState({
      board: 96,
      basesP0: [hex(-2, 2, 0), hex(4, -4, 0)],
      basesP1: [hex(2, 1, -3)],
      iron: [hex(2, -2, 0), hex(3, -3, 0), hex(0, 0, 0), hex(2, 0, -2)],
    });

  it("placing a base decrements the acting player's basesInHand and appends a fresh Base", () => {
    const s = baseFixture();
    const inHandBefore = s.players[0]!.basesInHand;
    const basesBefore = s.bases.length;
    const action: Action = { kind: "build", pieces: [{ type: "base", hex: hex(2, -2, 0) }] };
    const { state, events } = applyAction(s, action);

    expect(state.players[0]!.basesInHand).toBe(inHandBefore - 1);
    expect(state.bases).toHaveLength(basesBefore + 1);

    const placed = state.bases.find((b) => key(b.hex) === key(hex(2, -2, 0)));
    expect(placed).toBeDefined();
    expect(placed!.owner).toBe(0);
    expect(placed!.state).toBe("fresh");

    expect(events).toEqual([{ kind: "placed", piece: "base", hex: hex(2, -2, 0), owner: 0 }]);
  });

  it("appended bases have strictly increasing order greater than any pre-existing order", () => {
    const s = baseFixture();
    const maxOrderBefore = Math.max(...s.bases.map((b) => b.order));
    // Place two bases. (2,-2,0) sees both friendly bases; after it is placed it
    // becomes a third friendly base, enabling (3,-3,0) (within range, sees 2+).
    const action: Action = {
      kind: "build",
      pieces: [
        { type: "base", hex: hex(2, -2, 0) },
        { type: "base", hex: hex(3, -3, 0) },
      ],
    };
    const { state } = applyAction(s, action);

    const first = state.bases.find((b) => key(b.hex) === key(hex(2, -2, 0)))!;
    const second = state.bases.find((b) => key(b.hex) === key(hex(3, -3, 0)))!;
    expect(first.order).toBeGreaterThan(maxOrderBefore);
    expect(second.order).toBeGreaterThan(first.order);

    // basesInHand reduced by 2, bases array grew by 2.
    expect(state.players[0]!.basesInHand).toBe(s.players[0]!.basesInHand - 2);
    expect(state.bases).toHaveLength(s.bases.length + 2);
  });
});

describe("applyAction — build: validation throws", () => {
  it("throws on mixed-type pieces", () => {
    const s = factoryFixture();
    const action: Action = {
      kind: "build",
      pieces: [
        { type: "factory", hex: hex(6, -6, 0) },
        { type: "base", hex: hex(3, -3, 0) },
      ],
    };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("throws on an empty pieces array", () => {
    const s = factoryFixture();
    const action: Action = { kind: "build", pieces: [] };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("throws when pieces.length exceeds buildBudget", () => {
    // factoryFixture: oldest (0,0,0), farthest (4,-4,0); 1 controlled iron, 0
    // factories, <4 bases => bootstrap budget = 1. Two factories exceeds it.
    const s = factoryFixture();
    const action: Action = {
      kind: "build",
      pieces: [
        { type: "factory", hex: hex(6, -6, 0) },
        { type: "factory", hex: hex(3, -3, 0) },
        { type: "factory", hex: hex(5, -4, -1) },
      ],
    };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("throws when two pieces target the SAME hex (second fails legality on mutated state)", () => {
    const s = factoryFixture();
    const action: Action = {
      kind: "build",
      pieces: [
        { type: "factory", hex: hex(6, -6, 0) },
        { type: "factory", hex: hex(6, -6, 0) },
      ],
    };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("throws on an illegal single factory placement (on iron)", () => {
    const s = factoryFixture();
    // (5,-5,0) is iron => illegal factory placement.
    const action: Action = { kind: "build", pieces: [{ type: "factory", hex: hex(5, -5, 0) }] };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("throws on an illegal single base placement (sees only one friendly base)", () => {
    // p0 friendly bases; opponent p1 4-base perimeter blocks one sightline so the
    // target sees only one friendly base => illegal.
    const oppBases = [hex(2, 1, -3), hex(2, -1, -1), hex(4, -1, -3), hex(4, 1, -5)];
    const s = mkState({ board: 96, basesP0: [hex(-2, 2, 0), hex(4, -4, 0)], basesP1: oppBases });
    const action: Action = { kind: "build", pieces: [{ type: "base", hex: hex(0, 2, -2) }] };
    expect(() => applyAction(s, action)).toThrow();
  });

  it("throws when placing a base with basesInHand at 0", () => {
    const s = mkState({ board: 96, basesP0: [hex(-2, 2, 0), hex(4, -4, 0)], basesP1: [hex(2, 1, -3)] });
    s.players[0]!.basesInHand = 0;
    const action: Action = { kind: "build", pieces: [{ type: "base", hex: hex(2, -2, 0) }] };
    expect(() => applyAction(s, action)).toThrow();
  });
});

describe("applyAction — purity", () => {
  it("does not mutate the input state when building factories", () => {
    const s = factoryFixture();
    const supplyBefore = s.factorySupply;
    const factoriesLenBefore = s.factories.length;
    const action: Action = { kind: "build", pieces: [{ type: "factory", hex: hex(6, -6, 0) }] };
    const { state } = applyAction(s, action);

    expect(s.factorySupply).toBe(supplyBefore);
    expect(s.factories).toHaveLength(factoriesLenBefore);
    expect(state).not.toBe(s); // new object
    expect(state.factories).not.toBe(s.factories); // cloned array
  });

  it("does not mutate the input state when building bases", () => {
    const s = mkState({ board: 96, basesP0: [hex(-2, 2, 0), hex(4, -4, 0)], basesP1: [hex(2, 1, -3)] });
    const inHandBefore = s.players[0]!.basesInHand;
    const basesLenBefore = s.bases.length;
    const action: Action = { kind: "build", pieces: [{ type: "base", hex: hex(2, -2, 0) }] };
    const { state } = applyAction(s, action);

    expect(s.players[0]!.basesInHand).toBe(inHandBefore);
    expect(s.bases).toHaveLength(basesLenBefore);
    expect(state.bases).not.toBe(s.bases);
    expect(state.players).not.toBe(s.players);
    expect(state.players[0]).not.toBe(s.players[0]);
  });

  it("acts as the current player given by phase.order[indexInOrder]", () => {
    // Make p1 the current player; p1 has the legal-build fixture geometry.
    const s = mkState({ board: 96, basesP1: [hex(0, 0, 0), hex(2, -2, 0), hex(4, -4, 0)], iron: [hex(5, -5, 0)] });
    s.phase.indexInOrder = 1; // current player = order[1] = 1
    const action: Action = { kind: "build", pieces: [{ type: "factory", hex: hex(6, -6, 0) }] };
    const { state, events } = applyAction(s, action);
    expect(events[0]).toEqual({ kind: "placed", piece: "factory", hex: hex(6, -6, 0), owner: 1 });
    expect(state.factorySupply).toBe(s.factorySupply - 1);
  });
});

describe("applyAction — pass", () => {
  it("returns state unchanged with no events", () => {
    const s = factoryFixture();
    const action: Action = { kind: "pass" };
    const { state, events } = applyAction(s, action);
    expect(state).toBe(s);
    expect(events).toEqual([]);
  });
});

describe("applyAction — attack", () => {
  it("throws (implemented in Task 5.4)", () => {
    const s = factoryFixture();
    const action: Action = { kind: "attack", attacks: [{ target: hex(0, 0, 0), attackers: [], defender: hex(0, 0, 0) }] };
    expect(() => applyAction(s, action)).toThrow(/5\.4/);
  });
});
