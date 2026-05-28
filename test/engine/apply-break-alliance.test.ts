// ABOUTME: Tests for applyAction with break-alliance (alliance plan Phase 3) — weighted 2/3 success + cooldown.
// ABOUTME: Verifies both success and failure paths, RNG threading (one draw, state advanced), cooldown set either way.

import { describe, expect, it } from "vitest";
import { hex } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import { applyAction } from "../../src/engine/apply";
import { mkState } from "../helpers/state";
import { seed, nextFloat } from "../../src/rng/pcg";
import type { GameState } from "../../src/engine/types";

function mkAlliedAt(rngSeed: bigint): GameState {
  const cfg = { ...defaultConfig(), alliancesEnabled: true };
  let s = mkState({
    board: 96,
    basesP0: [hex(0, 0, 0)],
    basesP1: [hex(20, -20, 0)],
    basesP2: [hex(0, 20, -20)],
    iron: [hex(1, -1, 0), hex(20, -19, -1), hex(0, 19, -19)],
    config: cfg,
  });
  s = {
    ...s,
    rngState: seed(rngSeed),
    players: s.players.map((p) => {
      if (p.id === 0) return { ...p, alliance: [0, 1] };
      if (p.id === 1) return { ...p, alliance: [1, 0] };
      return p;
    }),
  };
  return s;
}

describe("applyAction — break-alliance (Phase 3)", () => {
  it("success path (draw < 2/3): mutually unallies AND sets actor's cooldown to 1", () => {
    // Find a seed whose first nextFloat() draw is < 2/3 — by trying small ints.
    let chosenSeed: bigint | null = null;
    for (let i = 1n; i < 1000n; i++) {
      const draw = nextFloat(seed(i)).value;
      if (draw < 2 / 3) {
        chosenSeed = i;
        break;
      }
    }
    expect(chosenSeed).not.toBeNull();
    const s = mkAlliedAt(chosenSeed!);
    const { state: out } = applyAction(s, { kind: "break-alliance", target: 1 });
    // Mutual unally.
    expect(out.players[0]!.alliance).not.toContain(1);
    expect(out.players[1]!.alliance).not.toContain(0);
    // Actor cooldown set.
    expect(out.players[0]!.allianceCooldownTurns).toBe(1);
    // Target's cooldown is NOT touched.
    expect(out.players[1]!.allianceCooldownTurns).toBe(0);
  });

  it("failure path (draw >= 2/3): alliance UNCHANGED, actor cooldown still set to 1", () => {
    // Find a seed whose first nextFloat draw is >= 2/3.
    let chosenSeed: bigint | null = null;
    for (let i = 1n; i < 1000n; i++) {
      const draw = nextFloat(seed(i)).value;
      if (draw >= 2 / 3) {
        chosenSeed = i;
        break;
      }
    }
    expect(chosenSeed).not.toBeNull();
    const s = mkAlliedAt(chosenSeed!);
    const { state: out } = applyAction(s, { kind: "break-alliance", target: 1 });
    // Alliance unchanged.
    expect(out.players[0]!.alliance).toContain(1);
    expect(out.players[1]!.alliance).toContain(0);
    // Actor cooldown still set.
    expect(out.players[0]!.allianceCooldownTurns).toBe(1);
  });

  it("advances rngState by exactly one step (GEO-3)", () => {
    const s = mkAlliedAt(42n);
    const before = s.rngState;
    const { state: out } = applyAction(s, { kind: "break-alliance", target: 1 });
    // rngState advanced past `before`.
    expect(out.rngState).not.toEqual(before);
    // And it equals one nextFloat() step from `before`.
    const expected = nextFloat(before).state;
    expect(out.rngState).toEqual(expected);
  });

  it("is deterministic: same seed + state yields identical results twice", () => {
    const s = mkAlliedAt(123n);
    const a = applyAction(s, { kind: "break-alliance", target: 1 });
    const b = applyAction(s, { kind: "break-alliance", target: 1 });
    expect(a.state).toEqual(b.state);
  });
});
