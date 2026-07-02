// ABOUTME: placeFirstBase command (A3.2) — legal/sequential placement, engine-throw → WireErrorCode mapping,
// ABOUTME: shared commitEntries persistence (log:NNNNNN, no snapshot), and the NOT_IN_SETUP post-setup path.
import { test, expect } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { logKey, SNAPSHOT_KEY } from "../../src/session/keys";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { legalFirstBaseHexes } from "../../src/index";
import type { SessionHeader } from "../../src/session/types";
import type { CommandCtx, SessionState } from "../../src/session/session-types";
import type { Hex } from "../../src/engine/types";

// A 2-HUMAN header on a fixed seed: no agent-drive interferes, allowPass stays false (defaultConfig).
const header: SessionHeader = {
  formatVersion: 1,
  replayVersion: "test",
  seed: 42n,
  config: defaultConfig(),
  boardSource: { kind: "generate", size: 96, ironCount: 14 },
  seats: [{ kind: "human" }, { kind: "human" }],
};

const freshSession = (): SessionState => openSession(header, DEFAULT_ROOM_OPTIONS);

const mkCtx = (actingSeat: number): CommandCtx => ({
  actingSeat,
  nowEpochMs: 1_000_000,
  decisionId: "test-decision",
});

/** The seat whose setup turn it currently is, derived from phase.order/indexInOrder (never assumed). */
function currentPlacer(s: SessionState): number {
  return s.game.phase.order[s.game.phase.indexInOrder]!;
}

test("legal placement: the current placer places a legal hex — persists log:000000, no snapshot, one applied broadcast", () => {
  const s = freshSession();
  const seat = currentPlacer(s);
  const hex = legalFirstBaseHexes(s.game)[0]!;

  const { next, effects } = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: 0, hex }, mkCtx(seat));

  expect(effects.persist).not.toBeNull();
  const putKeys = Object.keys(effects.persist!.put).sort();
  expect(putKeys).toEqual([logKey(0)]);
  expect(putKeys).not.toContain(SNAPSHOT_KEY);

  expect(effects.broadcast).toHaveLength(1);
  const msg = effects.broadcast[0]!;
  expect(msg.type).toBe("applied");
  if (msg.type !== "applied") throw new Error("expected applied");
  expect(msg.logIndex).toBe(0);
  expect(msg.entry).toBeDefined();
  expect(msg.entry.kind).toBe("placeFirstBase");

  expect(next.logLength).toBe(1);
  expect(next.game.phase.turn).toBe(0); // still setup — only one of two seats has placed
});

test("sequential placements: both seats place in order — log:000000 then log:000001", () => {
  const s0 = freshSession();
  const seat0 = currentPlacer(s0);
  const hex0 = legalFirstBaseHexes(s0.game)[0]!;
  const r0 = applyCommand(s0, { type: "placeFirstBase", expectedLogIndex: 0, hex: hex0 }, mkCtx(seat0));
  expect(Object.keys(r0.effects.persist!.put)).toEqual([logKey(0)]);

  const s1 = r0.next;
  const seat1 = currentPlacer(s1);
  expect(seat1).not.toBe(seat0);
  const hex1 = legalFirstBaseHexes(s1.game)[0]!;
  const r1 = applyCommand(s1, { type: "placeFirstBase", expectedLogIndex: 1, hex: hex1 }, mkCtx(seat1));
  expect(Object.keys(r1.effects.persist!.put)).toEqual([logKey(1)]);

  expect(r1.next.logLength).toBe(2);
});

test("HEX_OCCUPIED: second placer targets the first placer's hex", () => {
  const s0 = freshSession();
  const seat0 = currentPlacer(s0);
  const hex0 = legalFirstBaseHexes(s0.game)[0]!;
  const r0 = applyCommand(s0, { type: "placeFirstBase", expectedLogIndex: 0, hex: hex0 }, mkCtx(seat0));
  const s1 = r0.next;
  const seat1 = currentPlacer(s1);

  const { next, effects } = applyCommand(s1, { type: "placeFirstBase", expectedLogIndex: 1, hex: hex0 }, mkCtx(seat1));

  expect(next).toBe(s1);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("HEX_OCCUPIED");
});

test("HEX_NOT_OUTER: a non-outermost-ring hex is rejected", () => {
  const s = freshSession();
  const seat = currentPlacer(s);
  const center: Hex = { x: 0, y: 0, z: 0 }; // board center — never outermost ring on a size-96 board
  const legal = new Set(legalFirstBaseHexes(s.game).map((h) => `${h.x},${h.y},${h.z}`));
  expect(legal.has(`${center.x},${center.y},${center.z}`)).toBe(false);

  const { next, effects } = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: 0, hex: center }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("HEX_NOT_OUTER");
});

test("HEX_OFF_BOARD: an off-board hex is rejected", () => {
  const s = freshSession();
  const seat = currentPlacer(s);
  const offBoard: Hex = { x: 999, y: -999, z: 0 };

  const { next, effects } = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: 0, hex: offBoard }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("HEX_OFF_BOARD");
});

test("NOT_IN_SETUP: a placeFirstBase after setup completes (turn 1) is rejected", () => {
  const s0 = freshSession();
  const seat0 = currentPlacer(s0);
  const hex0 = legalFirstBaseHexes(s0.game)[0]!;
  const r0 = applyCommand(s0, { type: "placeFirstBase", expectedLogIndex: 0, hex: hex0 }, mkCtx(seat0));
  const s1 = r0.next;
  const seat1 = currentPlacer(s1);
  const hex1 = legalFirstBaseHexes(s1.game)[0]!;
  const r1 = applyCommand(s1, { type: "placeFirstBase", expectedLogIndex: 1, hex: hex1 }, mkCtx(seat1));
  const s2 = r1.next;

  // Both seats have placed — setup auto-advances to turn 1 on the final placement (engine placeFirstBase).
  expect(s2.game.phase.turn).toBe(1);

  // A further placeFirstBase from the now-current PLAY-phase actor. Any hex is fine — NOT_IN_SETUP fires
  // before the outer-ring/occupied checks (engine turn.ts: phase check is first).
  const anyHex = legalFirstBaseHexes(s0.game)[1]!; // an unoccupied-at-setup-time hex, unrelated to phase check
  const seat2 = s2.game.phase.order[s2.game.phase.indexInOrder]!;
  const { next, effects } = applyCommand(s2, { type: "placeFirstBase", expectedLogIndex: 2, hex: anyHex }, mkCtx(seat2));

  expect(next).toBe(s2);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("NOT_IN_SETUP");
});
