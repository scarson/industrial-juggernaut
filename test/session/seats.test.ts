// ABOUTME: claimSeat (A5.1) — own-seat check, requestId idempotency, multi-tab re-ack, out-of-range seat guard.
// ABOUTME: claimSeat is a roster ack, not authentication: ctx.actingSeat is already the authenticated seat.
import { test, expect } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import type { SessionHeader } from "../../src/session/types";
import type { CommandCtx, SessionState } from "../../src/session/session-types";

// A 2-HUMAN header on a fixed seed, matching the apply-command-envelope.test.ts convention.
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

test("own-seat ack: seatClaimed reply, claimed set, requestId recorded, NO side effects beyond the reply", () => {
  const s = freshSession();
  const { next, effects } = applyCommand(s, { type: "claimSeat", requestId: "req-1", seat: 0 }, mkCtx(0));

  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("seatClaimed");
  if (reply.type !== "seatClaimed") throw new Error("expected seatClaimed");
  expect(reply.seat).toBe(0);
  expect(reply.requestId).toBe("req-1");

  expect(next.seats[0]!.claimed).toBe(true);
  expect(next.seats[0]!.lastRequestId).toBe("req-1");

  // The full NO-side-effects mechanism: ephemeral roster state is never persisted/broadcast/pushed/alarmed.
  expect(effects.persist).toBeNull();
  expect(effects.broadcast).toEqual([]);
  expect(effects.toSeat).toEqual([]);
  expect(effects.alarm).toBeNull();

  // Other seats are untouched.
  expect(next.seats[1]!.claimed).toBe(false);
  expect(next.seats[1]!.lastRequestId).toBeNull();
});

test("wrong-seat ack: ctx.actingSeat !== seat is rejected with NOT_YOUR_TURN, no state change", () => {
  const s = freshSession();
  const { next, effects } = applyCommand(s, { type: "claimSeat", requestId: "req-1", seat: 1 }, mkCtx(0));

  expect(next).toBe(s); // identity — no new state object
  expect(effects.persist).toBeNull();
  expect(effects.broadcast).toEqual([]);
  expect(effects.toSeat).toEqual([]);
  expect(effects.alarm).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("NOT_YOUR_TURN");
});

test("idempotent re-ack: same requestId returns the same seatClaimed reply, NO new state object", () => {
  const s = freshSession();
  const first = applyCommand(s, { type: "claimSeat", requestId: "req-1", seat: 0 }, mkCtx(0));
  const second = applyCommand(first.next, { type: "claimSeat", requestId: "req-1", seat: 0 }, mkCtx(0));

  expect(second.next).toBe(first.next); // identity — re-ack is a pure no-op
  expect(second.effects.persist).toBeNull();
  expect(second.effects.broadcast).toEqual([]);
  expect(second.effects.toSeat).toEqual([]);
  expect(second.effects.alarm).toBeNull();
  expect(second.effects.reply).toHaveLength(1);
  const reply = second.effects.reply[0]!;
  expect(reply.type).toBe("seatClaimed");
  if (reply.type !== "seatClaimed") throw new Error("expected seatClaimed");
  expect(reply.seat).toBe(0);
  expect(reply.requestId).toBe("req-1");
});

test("multi-tab: a second ack on the same seat with a different requestId succeeds and updates lastRequestId", () => {
  const s = freshSession();
  const first = applyCommand(s, { type: "claimSeat", requestId: "req-1", seat: 0 }, mkCtx(0));
  const second = applyCommand(first.next, { type: "claimSeat", requestId: "req-2", seat: 0 }, mkCtx(0));

  expect(second.next).not.toBe(first.next); // a genuinely new ack — not the idempotent short-circuit
  expect(second.next.seats[0]!.claimed).toBe(true);
  expect(second.next.seats[0]!.lastRequestId).toBe("req-2");
  expect(second.effects.persist).toBeNull();
  expect(second.effects.reply).toHaveLength(1);
  const reply = second.effects.reply[0]!;
  expect(reply.type).toBe("seatClaimed");
  if (reply.type !== "seatClaimed") throw new Error("expected seatClaimed");
  expect(reply.requestId).toBe("req-2");
});

test("claimSeat bypasses the write-lock: succeeds even while a decision is pending", () => {
  const base = freshSession();
  const origin = { x: 0, y: 0, z: 0 };
  const s: SessionState = {
    ...base,
    pending: {
      decisionId: "pending-1",
      kind: "defenderChoice",
      round: 1,
      declaringPlayer: 0,
      promptedSeat: 1,
      proposed: { target: origin, attackers: [], defender: origin },
      preDecisionLogLength: 0,
      rngBeforeApply: base.game.rngState,
      deadlineEpochMs: null,
    },
  };
  const { next, effects } = applyCommand(s, { type: "claimSeat", requestId: "req-1", seat: 0 }, mkCtx(0));

  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("seatClaimed"); // NOT DECISION_PENDING — the write-lock never applies
  expect(next.seats[0]!.claimed).toBe(true);
  expect(next.pending).toBe(s.pending); // pending itself is untouched
});

test("through the envelope: applyCommand routes claimSeat to its handler, not the UNKNOWN_TYPE default", () => {
  const s = freshSession();
  const { effects } = applyCommand(s, { type: "claimSeat", requestId: "req-1", seat: 0 }, mkCtx(0));

  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("seatClaimed");
});

test("out-of-range seat index: a seat number with no matching roster entry is rejected as MALFORMED, no crash", () => {
  const s = freshSession();
  const { next, effects } = applyCommand(s, { type: "claimSeat", requestId: "req-1", seat: 99 }, mkCtx(99));

  expect(next).toBe(s); // identity — no state change
  expect(effects.persist).toBeNull();
  expect(effects.broadcast).toEqual([]);
  expect(effects.toSeat).toEqual([]);
  expect(effects.alarm).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("MALFORMED");
});
