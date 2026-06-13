// ABOUTME: Validation tests for applyOneAttack — duplicate attackers and self-defending targets.
// ABOUTME: Closes two server-authoritative validation holes (foundation plan Phase 2).

import { test, expect } from "vitest";
import { hex } from "../../src/geometry/cube";
import { mkState } from "../helpers/state";
import { applyAction } from "../../src/engine/apply";
import type { Action } from "../../src/engine/types";

// All coordinates verified on-board for the seed-1n/size-96 board in apply-attack.test.ts.
const TARGET = hex(2, -2, 0);
const DEFENDER = hex(0, -1, 1);

test("applyAction(attack) rejects duplicate attacker hexes (the six-copies auto-win exploit)", () => {
  // p0 has ONE fresh base; submitting it 6× would (pre-fix) read as commit-6 → auto-win.
  const state = mkState({ board: 96, basesP0: [hex(0, 0, 0)], basesP1: [TARGET, DEFENDER] });
  const dup: Action = { kind: "attack", attacks: [{ target: TARGET, attackers: [hex(0,0,0), hex(0,0,0), hex(0,0,0), hex(0,0,0), hex(0,0,0), hex(0,0,0)], defender: DEFENDER }] };
  expect(() => applyAction(state, dup)).toThrow(/distinct/i);
});

test("applyAction(attack) rejects the target base as its own defender", () => {
  // 3 distinct fresh attackers in range of TARGET; opponent has only the target base.
  const state = mkState({ board: 96, basesP0: [hex(0,0,0), hex(-1,1,0), hex(0,1,-1)], basesP1: [TARGET] });
  const selfDefend: Action = { kind: "attack", attacks: [{ target: TARGET, attackers: [hex(0,0,0), hex(-1,1,0), hex(0,1,-1)], defender: TARGET }] };
  expect(() => applyAction(state, selfDefend)).toThrow(/defender cannot be the target/i);
});
