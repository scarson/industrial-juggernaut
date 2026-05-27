// ABOUTME: MCTS search-tree data structures — nodes, per-action edges, max^n N-vector backup, per-acting-player PUCT selection.
// ABOUTME: Pure data + functions, no Math.random; designed so A3.2 expansion/chance-nodes and A3.3 leaf-eval/search-loop extend it.

import type { Action, PlayerId } from "../engine/types";

/** Default PUCT exploration constant (`c_puct`). A3.2 may override via params. */
export const defaultCPuct = 1.5;

/**
 * A per-action edge out of a node. `valueVec` is the per-player accumulated value
 * (an N-vector, one component per player) and `childN` the edge visit count.
 * `child` is filled at expansion time (A3.2) — undefined for an unexpanded edge.
 */
export interface Edge {
  readonly action: Action;
  childN: number;
  valueVec: number[];
  child?: Node;
}

/**
 * A search node. Carries its own visit count `N` (scalar) and accumulated
 * per-player value `valueVec` (N-vector), plus the candidate `edges`.
 */
export interface Node {
  N: number;
  valueVec: number[];
  readonly edges: Edge[];
}

/**
 * One step of a selection path: the node visited and the edge chosen out of it.
 * `backup` walks a path of these so it can update both node and edge stats —
 * the node N-vector/visit count and the edge N-vector/visit count are distinct
 * (max^n keeps per-player components independent). This is the documented
 * choice for the spec's `backup(path, leafValueVec)`: the path carries nodes so
 * node-level stats are updated alongside edges.
 */
export interface PathStep {
  readonly node: Node;
  readonly edge: Edge;
}

/** Build a node from candidate actions with zeroed stats for `playerCount` players. */
export function makeNode(actions: Action[], playerCount: number): Node {
  return {
    N: 0,
    valueVec: zeros(playerCount),
    edges: actions.map((action) => ({
      action,
      childN: 0,
      valueVec: zeros(playerCount),
    })),
  };
}

/**
 * max^n backup: add `leafValueVec` componentwise into every edge's `valueVec`
 * (incrementing `childN`) and into every node's `valueVec` (incrementing `N`)
 * along the selection path. The N-vector is per-player so each player's value
 * accumulates independently — this is max^n, NOT negamax (no sign flip per ply).
 */
export function backup(path: PathStep[], leafValueVec: number[]): void {
  for (const { node, edge } of path) {
    node.N += 1;
    addInto(node.valueVec, leafValueVec);
    edge.childN += 1;
    addInto(edge.valueVec, leafValueVec);
  }
}

/**
 * PUCT selection where the ACTING player maximizes their OWN value component —
 * this is what makes the search max^n. For each edge:
 *   Q = edge.valueVec[actingPlayer] / max(1, edge.childN)
 *   U = cPuct * prior * sqrt(node.N) / (1 + edge.childN)
 * with a uniform prior (`1 / node.edges.length`) for this task; A3.2 replaces it
 * with the policy prior. Returns the argmax edge, breaking ties to the lowest
 * edge index (deterministic).
 */
export function selectChild(node: Node, actingPlayer: PlayerId, cPuct: number): Edge {
  const edges = node.edges;
  if (edges.length === 0) {
    throw new Error("selectChild: node has no edges");
  }
  const prior = 1 / edges.length;
  const sqrtParentN = Math.sqrt(node.N);

  let bestEdge = edges[0]!;
  let bestScore = puctScore(bestEdge, actingPlayer, cPuct, prior, sqrtParentN);
  for (let i = 1; i < edges.length; i++) {
    const edge = edges[i]!;
    const score = puctScore(edge, actingPlayer, cPuct, prior, sqrtParentN);
    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }
  return bestEdge;
}

function puctScore(
  edge: Edge,
  actingPlayer: PlayerId,
  cPuct: number,
  prior: number,
  sqrtParentN: number,
): number {
  const q = (edge.valueVec[actingPlayer] ?? 0) / Math.max(1, edge.childN);
  const u = (cPuct * prior * sqrtParentN) / (1 + edge.childN);
  return q + u;
}

function zeros(n: number): number[] {
  return new Array<number>(n).fill(0);
}

/** Add `src` componentwise into `dst` (mutates `dst`). */
function addInto(dst: number[], src: number[]): void {
  for (let i = 0; i < src.length; i++) {
    dst[i] = (dst[i] ?? 0) + (src[i] ?? 0);
  }
}
