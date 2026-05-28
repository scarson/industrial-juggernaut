// ABOUTME: Tests for applyAction with the alliance-layer `ally` action (Phase 2 of the alliance plan).
// ABOUTME: Verifies mutual alliance refs added, basesInHand decremented by 1, illegal ally throws.

import { describe, expect, it } from "vitest";
import { hex } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import type { GameState } from "../../src/engine/types";

function mk3PWithAllianceFlag(extra: Partial<ReturnType<typeof defaultConfig>> = {}): GameState {
  const cfg = { ...defaultConfig(), alliancesEnabled: true, ...extra };
  return mkState({
    board: 96,
    basesP0: [hex(0, 0, 0)],
    basesP1: [hex(20, -20, 0)],
    basesP2: [hex(0, 20, -20)],
    iron: [hex(1, -1, 0), hex(20, -19, -1), hex(0, 19, -19)],
    config: cfg,
  });
}

describe("applyAction — `ally` (Phase 2)", () => {
  it("adds mutual alliance refs to both players and decrements actor's basesInHand by 1", () => {
    const s = mk3PWithAllianceFlag();
    const p0BasesBefore = s.players[0]!.basesInHand;
    const { state: out } = applyAction(s, { kind: "ally", target: 1 });
    // Mutual alliance: both arrays must contain the other's id.
    expect(out.players[0]!.alliance).toContain(1);
    expect(out.players[1]!.alliance).toContain(0);
    // Self-id remains in each player's own alliance (alliance includes self by convention).
    expect(out.players[0]!.alliance).toContain(0);
    expect(out.players[1]!.alliance).toContain(1);
    // Player 2's alliance is untouched.
    expect(out.players[2]!.alliance).toEqual([2]);
    // basesInHand cost: actor (p0) decrements by 1; target (p1) unchanged.
    expect(out.players[0]!.basesInHand).toBe(p0BasesBefore - 1);
    expect(out.players[1]!.basesInHand).toBe(s.players[1]!.basesInHand);
  });

  it("throws when alliancesEnabled is false (Phase 1 stub branch)", () => {
    const s = mk3PWithAllianceFlag({ alliancesEnabled: false });
    expect(() => applyAction(s, { kind: "ally", target: 1 })).toThrow();
  });

  it("does not double-add when called twice on the same pair (idempotent on the alliance side)", () => {
    // (Defensive — applyAction will be called only when legalActions emits the action; the second
    // call would not be legal. But the engine should not produce a corrupted alliance array if
    // somehow invoked twice.)
    const s = mk3PWithAllianceFlag();
    const { state: s1 } = applyAction(s, { kind: "ally", target: 1 });
    const { state: s2 } = applyAction(s1, { kind: "ally", target: 1 });
    expect(s2.players[0]!.alliance.filter((id) => id === 1).length).toBe(1);
    expect(s2.players[1]!.alliance.filter((id) => id === 0).length).toBe(1);
  });
});
