// ABOUTME: Coordinate-validity gates for loadBoard — non-integer and out-of-range hex/iron
// ABOUTME: coordinates must be rejected before they corrupt key()/distance() downstream.
import { describe, it, expect } from "vitest";
import { loadBoard } from "../../src/board/load";

describe("loadBoard coordinate validation", () => {
  it("rejects a fractional-but-cube-sum-zero hex coordinate", () => {
    expect(() =>
      loadBoard({ hexes: [{ x: 0.5, y: -0.5, z: 0 }], iron: [] }),
    ).toThrow(
      "loadBoard: hex (0.5,-0.5,0) in def.hexes has non-integer coordinate x=0.5",
    );
  });

  it("rejects a huge-magnitude hex coordinate distinct from the integer check", () => {
    // Number.isInteger(1e308) is true (integer-valued float); the magnitude bound
    // is what must catch this, not the integer check.
    expect(() =>
      loadBoard({ hexes: [{ x: 1e308, y: -1e308, z: 0 }], iron: [] }),
    ).toThrow(
      "loadBoard: hex (1e+308,-1e+308,0) in def.hexes has coordinate x=1e+308 exceeding MAX_BOARD_COORD=1024",
    );
  });

  it("rejects a fractional iron coordinate, not just hexes", () => {
    // hexes is entirely valid; only iron carries the fractional coordinate, so this
    // exercises the def.iron branch of the coordinate check specifically.
    expect(() =>
      loadBoard({
        hexes: [{ x: 0, y: 0, z: 0 }],
        iron: [{ x: 0.5, y: -0.5, z: 0 }],
      }),
    ).toThrow(
      "loadBoard: hex (0.5,-0.5,0) in def.iron has non-integer coordinate x=0.5",
    );
  });

  it("rejects a huge-magnitude iron coordinate, not just hexes", () => {
    expect(() =>
      loadBoard({
        hexes: [{ x: 0, y: 0, z: 0 }],
        iron: [{ x: 1e308, y: -1e308, z: 0 }],
      }),
    ).toThrow(
      "loadBoard: hex (1e+308,-1e+308,0) in def.iron has coordinate x=1e+308 exceeding MAX_BOARD_COORD=1024",
    );
  });

  it("still loads a legal small board", () => {
    const def = {
      hexes: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: -1, z: 0 },
      ],
      iron: [{ x: 1, y: -1, z: 0 }],
    };
    const board = loadBoard(def);
    expect(board.hexes).toEqual(def.hexes);
    expect(board.iron).toEqual(def.iron);
  });
});
