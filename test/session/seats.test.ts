// ABOUTME: claimSeat (A5.1) — own-seat check, requestId idempotency, multi-tab re-ack, out-of-range seat guard, claim-transition broadcast.
// ABOUTME: claimSeat is a roster ack, not authentication: ctx.actingSeat is already the authenticated seat. seatRoster (A5.2) is the shared roster-projection helper.
import { test, expect } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { seatRoster } from "../../src/session/seats";
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

// A mixed human+agent header for seatRoster's shape/order test.
const mixedHeader: SessionHeader = {
  formatVersion: 1,
  replayVersion: "test",
  seed: 42n,
  config: defaultConfig(),
  boardSource: { kind: "generate", size: 96, ironCount: 14 },
  seats: [{ kind: "human" }, { kind: "agent", agent: "heuristic" }, { kind: "human" }],
};

const freshSession = (): SessionState => openSession(header, DEFAULT_ROOM_OPTIONS);

const mkCtx = (actingSeat: number): CommandCtx => ({
  actingSeat,
  nowEpochMs: 1_000_000,
  decisionId: "test-decision",
});

test("own-seat ack: seatClaimed reply + broadcast on the claim transition; no persist/toSeat/alarm", () => {
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

  // The claimed false→true transition ALSO broadcasts the seatClaimed message: the protocol has no periodic
  // refresh (resyncs fire only on connect/stale-index/explicit request), so without it an idle lobby client
  // would never see a seat fill. Ephemeral roster state is still never persisted/pushed/alarmed.
  expect(effects.persist).toBeNull();
  expect(effects.broadcast).toEqual([{ type: "seatClaimed", seat: 0, requestId: "req-1" }]);
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
  expect(second.effects.broadcast).toEqual([]); // no re-broadcast — the broadcast is gated on the claim transition
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
  // claimed was ALREADY true — no false→true transition, so no re-broadcast (multi-tab acks stay quiet).
  expect(second.effects.broadcast).toEqual([]);
  expect(second.effects.toSeat).toEqual([]);
  expect(second.effects.alarm).toBeNull();
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

test("seatRoster: maps a mixed human+agent header to { seat, claimed, kind } in seat order, reflecting claims", () => {
  const base = openSession(mixedHeader, DEFAULT_ROOM_OPTIONS);
  const { next } = applyCommand(base, { type: "claimSeat", requestId: "req-1", seat: 1 }, mkCtx(1));

  const roster = seatRoster(next);

  expect(roster).toEqual([
    { seat: 0, claimed: false, kind: "human" },
    { seat: 1, claimed: true, kind: "agent" },
    { seat: 2, claimed: false, kind: "human" },
  ]);
});
