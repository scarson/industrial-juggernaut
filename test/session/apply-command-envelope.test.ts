// ABOUTME: applyCommand envelope guards (A3.1) — GAME_OVER/DECISION_PENDING/STALE_INDEX/NOT_YOUR_TURN order,
// ABOUTME: the mutating/non-mutating split, the UNKNOWN_TYPE default, and the resyncPayload shape. Optimistic concurrency.
import { test, expect } from "vitest";
import { openSession, applyCommand, resyncPayload } from "../../src/session/session";
import { decodeState } from "../../src/wire/codec";
import { DEFAULT_ROOM_OPTIONS, PROTOCOL_VERSION } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { legalFirstBaseHexes } from "../../src/index";
import type { SessionHeader } from "../../src/session/types";
import type { CommandCtx, Pending, SessionState } from "../../src/session/session-types";
import type { AttackDecl } from "../../src/engine/types";

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

// A minimal Pending for the DECISION_PENDING / guard-order paths. Values are inert — the A3 guard only
// checks `s.pending !== null`; it never reads these fields.
const minimalPending = (): Pending => {
  const origin = { x: 0, y: 0, z: 0 };
  const decl: AttackDecl = { target: origin, attackers: [], defender: origin };
  return {
    decisionId: "pending-1",
    kind: "defenderChoice",
    round: 1,
    declaringPlayer: 0,
    promptedSeat: 1,
    proposed: decl,
    preDecisionLogLength: 0,
    rngBeforeApply: freshSession().game.rngState,
    deadlineEpochMs: null,
  };
};

test("STALE_INDEX: a pass with a wrong expectedLogIndex replies with a resync and leaves state unchanged", () => {
  const s = freshSession();
  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: 99 }, mkCtx(0));

  // Mechanism: no state mutation (identity), no persist.
  expect(next).toBe(s);
  expect(effects.persist).toBeNull();

  // A stale index resyncs (mismatch-and-resync makes lost-ack retries safe) — NOT a bare error.
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("resync");
  if (reply.type !== "resync") throw new Error("expected resync");
  expect(reply.reason).toBe("STALE_INDEX");
  expect(reply.logLength).toBe(s.logLength); // 0 for a fresh session
  expect(effects.broadcast).toEqual([]);
});

test("NOT_YOUR_TURN: an out-of-turn actor with a correct expectedLogIndex is rejected", () => {
  const s = freshSession();
  // Fresh session: currentActor === seat 0 (setup placement order [0,1], index 0). Seat 1 acting is out of turn.
  const { next, effects } = applyCommand(
    s,
    { type: "placeFirstBase", expectedLogIndex: 0, hex: { x: 0, y: 0, z: 0 } },
    mkCtx(1),
  );

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("NOT_YOUR_TURN");
  expect(reply.currentLogIndex).toBe(s.logLength);
});

test("DECISION_PENDING: a mutating command while a decision is pending is rejected", () => {
  const s: SessionState = { ...freshSession(), pending: minimalPending() };
  // Correct index + correct actor — only the pending should stop it.
  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: 0 }, mkCtx(0));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("DECISION_PENDING");
});

test("GAME_OVER: a mutating command after victory is rejected", () => {
  // Construction: a 2-player fresh session, mark player 1 eliminated on a state copy. With one non-eliminated
  // coalition left, status() reports last-standing victory (players:[0], reason:"last-standing") — no base
  // counts needed (verified against src/engine/status.ts §(b)). This is the cheapest legitimate victory.
  const base = freshSession();
  const s: SessionState = {
    ...base,
    game: {
      ...base.game,
      players: base.game.players.map((p, i) => (i === 1 ? { ...p, eliminated: true } : p)),
    },
  };
  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: 0 }, mkCtx(0));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("GAME_OVER");
});

test("guard ORDER: DECISION_PENDING is checked before STALE_INDEX", () => {
  // Both a pending decision AND a stale index. The plan's order pins pending BEFORE stale, so the reply is
  // the DECISION_PENDING error, not a STALE_INDEX resync.
  const s: SessionState = { ...freshSession(), pending: minimalPending() };
  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: 99 }, mkCtx(0));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("DECISION_PENDING");
});

test("non-mutating bypass: resync skips the envelope guards even with a pending set", () => {
  // resync is non-mutating: it must NOT hit GAME_OVER/DECISION_PENDING/STALE_INDEX/NOT_YOUR_TURN. With a
  // pending set (which would trip a mutating command), it falls straight to the switch default → UNKNOWN_TYPE
  // (until A6 implements resync). This pins the isMutating exemption.
  const s: SessionState = { ...freshSession(), pending: minimalPending() };
  const { next, effects } = applyCommand(s, { type: "resync" }, mkCtx(0));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("UNKNOWN_TYPE"); // NOT DECISION_PENDING — the guards were bypassed
});

test("non-mutating bypass: extendDecision skips the envelope guards and reaches its handler (A4.3)", () => {
  // extendDecision only re-arms the alarm; it is exempt from the envelope guards and the write-lock. With a
  // pending set (promptedSeat 1) it does NOT trip GAME_OVER/DECISION_PENDING/STALE_INDEX; it reaches the
  // extendDecision handler, whose OWN seat auth rejects a non-prompted seat with NOT_YOUR_TURN (A4.3). Reaching
  // that handler-level rejection (rather than the envelope's DECISION_PENDING) is the bypass proof.
  const s: SessionState = { ...freshSession(), pending: minimalPending() };
  const { next, effects } = applyCommand(s, { type: "extendDecision", decisionId: "pending-1" }, mkCtx(0));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("NOT_YOUR_TURN"); // handler-level seat auth (seat 0 != promptedSeat 1), NOT DECISION_PENDING
});

test("envelope guards pass → the attack HANDLER runs (A4.3): an attack at an empty target hex → MALFORMED", () => {
  // attack in the PLAY phase (setup completed) with the correct index and the current actor. Every envelope
  // guard passes — including the setup-phase SETUP_PLACEMENT_REQUIRED guard, which is why setup must finish
  // first — so control reaches the attack handler (A4.3). With no base at the target hex the handler replies
  // MALFORMED. (This slot previously pinned the UNKNOWN_TYPE default for still-unimplemented mutating commands;
  // A4.3 implements attack/endRound/resolveDecision, so no mutating command hits the default any more — the
  // slot now proves the guards forward a well-formed mutating command into its handler.)
  let s = freshSession();
  let idx = 0;
  while (s.game.phase.turn === 0) {
    const placer = s.game.phase.order[s.game.phase.indexInOrder]!;
    const hex = legalFirstBaseHexes(s.game)[0]!;
    const r = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: idx, hex }, mkCtx(placer));
    if (r.effects.persist === null) throw new Error(`setup placement rejected at idx ${idx}`);
    s = r.next;
    idx += 1;
  }
  const actor = s.game.phase.order[s.game.phase.indexInOrder]!;
  const origin = { x: 0, y: 0, z: 0 };
  const decl: AttackDecl = { target: origin, attackers: [], defender: origin };
  const { next, effects } = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl }, mkCtx(actor));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("MALFORMED");
});

test("resyncPayload shape: snapshot round-trips and header fields match", () => {
  const s = freshSession();
  const payload = resyncPayload(s, 0, "STALE_INDEX");
  expect(payload.type).toBe("resync");
  if (payload.type !== "resync") throw new Error("expected resync");

  // snapshot decodes back to the live engine state (structural round-trip through the codec).
  const decoded = decodeState(payload.snapshot);
  expect(decoded).toEqual(s.game);

  expect(payload.logLength).toBe(s.logLength);
  expect(payload.pending).toBeNull(); // A3 creates no pending
  expect(payload.protocolVersion).toBe(PROTOCOL_VERSION);
  expect(payload.replayVersion).toBe(s.header.replayVersion);
  expect(payload.reason).toBe("STALE_INDEX");

  // Roster maps s.seats → { seat, claimed, kind }. Two unclaimed human seats.
  expect(payload.seats).toHaveLength(2);
  expect(payload.seats.map((r) => r.kind)).toEqual(["human", "human"]);
  expect(payload.seats.map((r) => r.seat)).toEqual([0, 1]);
  expect(payload.seats.every((r) => r.claimed === false)).toBe(true);
});

test("resyncPayload accepts a null reason", () => {
  const s = freshSession();
  const payload = resyncPayload(s, 0, null);
  if (payload.type !== "resync") throw new Error("expected resync");
  expect(payload.reason).toBeNull();
});
