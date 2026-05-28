// ABOUTME: Tests that legalActions bans the ally action when the merged coalition would include EVERY alive player.
// ABOUTME: An all-player coalition is functionally identical to unanimous concession — banned at the rules level.

import { describe, expect, it } from "vitest";
import { mkState } from "../helpers/state";
import { hex } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import { legalActions } from "../../src/engine/legal";
import type { GameState } from "../../src/engine/types";

function mk3PWithAlliances(): GameState {
  const cfg = { ...defaultConfig(), alliancesEnabled: true, allianceVictoryDelta: 4 };
  return mkState({
    board: 96,
    basesP0: [hex(0, 0, 0)],
    basesP1: [hex(20, -20, 0)],
    basesP2: [hex(0, 20, -20)],
    iron: [hex(1, -1, 0), hex(20, -19, -1), hex(0, 19, -19)],
    config: cfg,
  });
}

describe("legalActions — all-player coalition ban", () => {
  it("at game start in 3P, every pairwise ally is legal (no coalition yet so merging 2 of 3 is allowed)", () => {
    const state = mk3PWithAlliances();
    const actions = legalActions(state);
    const allyActions = actions.filter((a) => a.kind === "ally");
    // P0's legal ally targets: P1 and P2 (each forms a 2-of-3 coalition — allowed).
    const targets = new Set(allyActions.map((a) => (a.kind === "ally" ? a.target : -1)));
    expect(targets).toEqual(new Set([1, 2]));
  });

  it("when an actor is already in a 2-player coalition (P0↔P1) in a 3P game, ally(P2) is BANNED (would merge to all-3)", () => {
    const base = mk3PWithAlliances();
    // Wire P0 ↔ P1 alliance manually.
    const players = base.players.map((p, i) => {
      if (i === 0) return { ...p, alliance: [0 as const, 1 as const] };
      if (i === 1) return { ...p, alliance: [1 as const, 0 as const] };
      return p;
    });
    const state: GameState = { ...base, players };
    const actions = legalActions(state);
    const allyActions = actions.filter((a) => a.kind === "ally");
    // The only remaining non-allied target for P0 is P2, but that would create the all-player coalition.
    expect(allyActions).toEqual([]);
  });

  it("when an actor is already in a 2-player coalition (P0↔P1) in a 4P game, ally(P2) IS legal (would create 3-of-4, not all)", () => {
    const cfg = { ...defaultConfig(), alliancesEnabled: true, allianceVictoryDelta: 4 };
    const base = mkState({
      board: 96,
      basesP0: [hex(0, 0, 0)],
      basesP1: [hex(20, -20, 0)],
      basesP2: [hex(0, 20, -20)],
      basesP3: [hex(-20, 0, 20)],
      iron: [hex(1, -1, 0)],
      config: cfg,
    });
    const players = base.players.map((p, i) => {
      if (i === 0) return { ...p, alliance: [0 as const, 1 as const] };
      if (i === 1) return { ...p, alliance: [1 as const, 0 as const] };
      return p;
    });
    const state: GameState = { ...base, players };
    const actions = legalActions(state);
    const allyActions = actions.filter((a) => a.kind === "ally");
    const targets = new Set(allyActions.map((a) => (a.kind === "ally" ? a.target : -1)));
    // P0 can ally P2 (creates {P0,P1,P2}, leaves P3) or P3 (creates {P0,P1,P3}, leaves P2). Both legal.
    expect(targets).toEqual(new Set([2, 3]));
  });

  it("in 3P with one player eliminated, ally between the two survivors is BANNED (would create the only alive coalition)", () => {
    const base = mk3PWithAlliances();
    const players = base.players.map((p, i) => (i === 2 ? { ...p, eliminated: true } : p));
    const state: GameState = { ...base, players };
    const actions = legalActions(state);
    const allyActions = actions.filter((a) => a.kind === "ally");
    // P0's only legal ally target would be P1 (P2 eliminated). But P0+P1 = all alive → banned.
    expect(allyActions).toEqual([]);
  });
});
