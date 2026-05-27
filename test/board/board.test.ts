import { describe, it, expect } from "vitest";
import { seed } from "../../src/rng/pcg";
import { generateBoard } from "../../src/board/generate";
import { loadBoard } from "../../src/board/load";
import { key } from "../../src/geometry/cube";

describe("board sources", () => {
  it("generateBoard is deterministic for a seed", () => {
    const a = generateBoard(seed(5n), { size: 96, ironCount: 14 });
    const b = generateBoard(seed(5n), { size: 96, ironCount: 14 });
    expect(a.board.hexes.map(key)).toEqual(b.board.hexes.map(key));
    expect(a.board.iron.map(key)).toEqual(b.board.iron.map(key));
  });
  it("loadBoard round-trips a fixed definition", () => {
    const def = { hexes: [{x:0,y:0,z:0},{x:1,y:-1,z:0}], iron: [{x:1,y:-1,z:0}] };
    const board = loadBoard(def);
    expect(board.hexes.map(key)).toEqual(["0,0,0","1,-1,0"]);
    expect(board.iron.map(key)).toEqual(["1,-1,0"]);
  });
  it("loadBoard rejects iron not in hexes", () => {
    expect(() => loadBoard({ hexes: [{x:0,y:0,z:0}], iron: [{x:9,y:-9,z:0}] })).toThrow();
  });

  it("loadBoard rejects a hex with x+y+z !== 0", () => {
    expect(() => loadBoard({ hexes: [{x:1,y:1,z:1}], iron: [] })).toThrow();
  });
  it("loadBoard rejects duplicate hexes", () => {
    expect(() =>
      loadBoard({ hexes: [{x:0,y:0,z:0},{x:0,y:0,z:0}], iron: [] }),
    ).toThrow();
  });
  it("loadBoard rejects duplicate iron", () => {
    expect(() =>
      loadBoard({
        hexes: [{x:0,y:0,z:0},{x:1,y:-1,z:0}],
        iron: [{x:1,y:-1,z:0},{x:1,y:-1,z:0}],
      }),
    ).toThrow();
  });
  it("generateBoard produces ironCount iron all within hexes", () => {
    const { board } = generateBoard(seed(7n), { size: 96, ironCount: 14 });
    expect(board.iron).toHaveLength(14);
    const hexKeys = new Set(board.hexes.map(key));
    for (const ir of board.iron) {
      expect(hexKeys.has(key(ir))).toBe(true);
    }
  });
});
