// ABOUTME: Tests for the MCTS search-tree data structures — max^n backup and per-acting-player PUCT selection.
// ABOUTME: Structural/deterministic; the load-bearing case is selectChild picking different edges for different acting players.

import { describe, expect, it } from "vitest";
import {
  makeNode,
  backup,
  selectChild,
  defaultCPuct,
  type Node,
  type Edge,
  type PathStep,
} from "../../src/agent/mcts";
import type { Action } from "../../src/engine/types";

const PASS: Action = { kind: "pass" };
const A: Action = { kind: "build", pieces: [{ type: "factory", hex: { x: 0, y: 0, z: 0 } }] };
const B: Action = { kind: "build", pieces: [{ type: "base", hex: { x: 1, y: -1, z: 0 } }] };

describe("makeNode", () => {
  it("builds a node from candidate actions with zeroed stats for 2 players", () => {
    const node = makeNode([A, B], 2);
    expect(node.N).toBe(0);
    expect(node.valueVec).toEqual([0, 0]);
    expect(node.edges).toHaveLength(2);
    for (const edge of node.edges) {
      expect(edge.childN).toBe(0);
      expect(edge.valueVec).toEqual([0, 0]);
      expect(edge.child).toBeUndefined();
    }
    expect(node.edges[0]!.action).toBe(A);
    expect(node.edges[1]!.action).toBe(B);
  });

  it("sizes the value vectors to the player count", () => {
    const node = makeNode([PASS], 6);
    expect(node.valueVec).toEqual([0, 0, 0, 0, 0, 0]);
    expect(node.edges[0]!.valueVec).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("backup (max^n, per-player N-vector)", () => {
  it("accumulates the leaf N-vector componentwise into each edge and increments childN / node N", () => {
    const root = makeNode([A, B], 2);
    const child = makeNode([PASS], 2);
    const rootEdge = root.edges[0]!; // edge A from root
    const childEdge = child.edges[0]!; // edge PASS from child
    rootEdge.child = child;

    const path: PathStep[] = [
      { node: root, edge: rootEdge },
      { node: child, edge: childEdge },
    ];

    backup(path, [1, 0]);

    // Each edge accumulated [1,0], childN incremented, node N incremented.
    expect(rootEdge.valueVec).toEqual([1, 0]);
    expect(rootEdge.childN).toBe(1);
    expect(childEdge.valueVec).toEqual([1, 0]);
    expect(childEdge.childN).toBe(1);
    expect(root.N).toBe(1);
    expect(root.valueVec).toEqual([1, 0]);
    expect(child.N).toBe(1);
    expect(child.valueVec).toEqual([1, 0]);

    // Untouched sibling edge stays zeroed.
    expect(root.edges[1]!.valueVec).toEqual([0, 0]);
    expect(root.edges[1]!.childN).toBe(0);
  });

  it("accumulates each player's component independently across multiple backups", () => {
    const root = makeNode([A], 2);
    const edge = root.edges[0]!;
    const path: PathStep[] = [{ node: root, edge }];

    backup(path, [1, 0]);
    backup(path, [0, 1]);
    backup(path, [0, 1]);

    // Player 0 got 1 unit, player 1 got 2 units — accumulated separately.
    expect(edge.valueVec).toEqual([1, 2]);
    expect(edge.childN).toBe(3);
    expect(root.N).toBe(3);
    expect(root.valueVec).toEqual([1, 2]);
  });
});

describe("selectChild (per-acting-player PUCT — max^n)", () => {
  it("the SAME node yields different selections depending on the acting player", () => {
    // Edge A: high mean value for player 0, low for player 1.
    // Edge B: high mean value for player 1, low for player 0.
    // Both equally visited so the U term is identical between them.
    const node = makeNode([A, B], 2);
    node.N = 100;
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    edgeA.childN = 50;
    edgeA.valueVec = [50 * 0.9, 50 * 0.1]; // mean [0.9, 0.1]
    edgeB.childN = 50;
    edgeB.valueVec = [50 * 0.1, 50 * 0.9]; // mean [0.1, 0.9]

    // Player 0 maximizes their own component -> picks A.
    expect(selectChild(node, 0, defaultCPuct).action).toBe(A);
    // Player 1 maximizes their own component -> picks B.
    expect(selectChild(node, 1, defaultCPuct).action).toBe(B);
  });

  it("computes Q from the acting player's own component with exact PUCT arithmetic", () => {
    const node = makeNode([A, B], 2);
    node.N = 9; // sqrt(9) = 3
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    edgeA.childN = 3;
    edgeA.valueVec = [3 * 0.5, 0]; // Q for p0 = 0.5
    edgeB.childN = 1;
    edgeB.valueVec = [1 * 0.4, 0]; // Q for p0 = 0.4

    const cPuct = 1.0;
    const prior = 1 / 2; // uniform over 2 edges
    // scoreA = 0.5 + 1.0 * 0.5 * 3 / (1+3) = 0.5 + 0.375 = 0.875
    // scoreB = 0.4 + 1.0 * 0.5 * 3 / (1+1) = 0.4 + 0.75  = 1.15
    expect(selectChild(node, 0, cPuct).action).toBe(B);

    // Sanity: with cPuct = 0, only Q matters -> A wins (0.5 > 0.4).
    expect(selectChild(node, 0, 0).action).toBe(A);
    void prior;
  });
});

describe("selectChild — PUCT exploration term", () => {
  it("with equal Q, the less-visited edge gets a higher U and is selected", () => {
    const node = makeNode([A, B], 2);
    node.N = 20;
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    // Equal mean Q = 0.5 for player 0, but B is far less visited.
    edgeA.childN = 10;
    edgeA.valueVec = [10 * 0.5, 0];
    edgeB.childN = 2;
    edgeB.valueVec = [2 * 0.5, 0];

    // U_A = c * prior * sqrt(20)/(1+10); U_B = c * prior * sqrt(20)/(1+2) -> U_B larger.
    expect(selectChild(node, 0, defaultCPuct).action).toBe(B);
  });

  it("a larger cPuct favors exploration of the less-visited edge", () => {
    const node = makeNode([A, B], 2);
    node.N = 16; // sqrt = 4
    const edgeA = node.edges[0]!;
    const edgeB = node.edges[1]!;
    // A has slightly higher Q but is more visited; B is less visited.
    edgeA.childN = 7;
    edgeA.valueVec = [7 * 0.6, 0]; // Q = 0.6
    edgeB.childN = 1;
    edgeB.valueVec = [1 * 0.5, 0]; // Q = 0.5
    const prior = 0.5;

    // Small cPuct: Q dominates -> A.
    // scoreA = 0.6 + 0.1*0.5*4/8 = 0.6 + 0.025 = 0.625
    // scoreB = 0.5 + 0.1*0.5*4/2 = 0.5 + 0.1   = 0.6
    expect(selectChild(node, 0, 0.1).action).toBe(A);

    // Large cPuct: U dominates -> B.
    // scoreA = 0.6 + 5*0.5*4/8 = 0.6 + 1.25 = 1.85
    // scoreB = 0.5 + 5*0.5*4/2 = 0.5 + 5.0  = 5.5
    expect(selectChild(node, 0, 5).action).toBe(B);
    void prior;
  });
});

describe("selectChild — deterministic tie-break", () => {
  it("breaks ties to the lowest edge index", () => {
    const node = makeNode([A, B], 2);
    node.N = 4;
    // Identical stats on both edges -> identical scores -> pick index 0 (A).
    for (const edge of node.edges) {
      edge.childN = 2;
      edge.valueVec = [2 * 0.5, 0];
    }
    expect(selectChild(node, 0, defaultCPuct).action).toBe(A);
  });

  it("uses U with node.N=0 so an unexpanded node still selects index 0 deterministically", () => {
    // N=0 -> sqrt(0)=0 -> U=0 for all edges; all Q=0 -> tie -> index 0.
    const node = makeNode([A, B], 2);
    expect(selectChild(node, 0, defaultCPuct).action).toBe(A);
  });
});

// Type-level sanity that the exported shapes are usable as documented.
describe("exported types", () => {
  it("Node/Edge expose the documented fields", () => {
    const node: Node = makeNode([A], 2);
    const edge: Edge = node.edges[0]!;
    expect(typeof node.N).toBe("number");
    expect(Array.isArray(node.valueVec)).toBe(true);
    expect(typeof edge.childN).toBe("number");
    expect(Array.isArray(edge.valueVec)).toBe(true);
  });
});
