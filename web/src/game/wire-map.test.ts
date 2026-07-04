// ABOUTME: Pins wire-map — the typed seam between DriverCommand/DriverEvent and the wire protocol.
// ABOUTME: Fixtures are built by encoding a REAL minimal GameState, so decode paths are exercised end-to-end.
import { describe, expect, test } from "vitest";
import { WIRE_TO_DRIVER_ERROR, toClientCommand, toDriverEvent } from "./wire-map";
import { WIRE_ERROR_CODES } from "../../../src/wire/protocol";
import { encodeState } from "../../../src/wire/codec";
import { encodeEntry, defaultConfig } from "../engine-client/barrel";
import { openSession } from "../../../src/session/session";
import type { DriverCommand } from "./driver";
import type {
  ClientCommand,
  EncodedPending,
  ServerMessage,
  SeatRosterEntry,
  WireErrorCode,
} from "../../../src/wire/protocol";
import type { GameState, LogEntry, SessionHeader } from "../engine-client/barrel";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────
/** A deterministic 2-human session header (seed-1 board) — the minimal real state the codecs round-trip. */
function realHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 1n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "human" }, { kind: "human" }],
  };
}

/** The live GameState from a freshly-opened deterministic session. */
function freshGame(): GameState {
  const s = openSession(realHeader(), { defenderTimeout: { enabled: false, seconds: 120 } });
  return s.game;
}

const HEX = { x: 0, y: 0, z: 0 };

function encodedPendingFixture(): EncodedPending {
  return {
    decisionId: "dec-1",
    kind: "defenderChoice",
    round: 3,
    declaringPlayer: 0,
    promptedSeat: 1,
    target: { x: 1, y: -1, z: 0 },
    eligibleDefenders: [{ x: 2, y: -2, z: 0 }],
    deadlineEpochMs: null,
  };
}

// ── toClientCommand: stamps expectedLogIndex on the six mutating commands ──────────────────────────────────────
describe("toClientCommand", () => {
  const LOG_LENGTH = 7;

  test("placeFirstBase stamps expectedLogIndex and carries hex", () => {
    const cmd: DriverCommand = { type: "placeFirstBase", hex: HEX };
    const wire = toClientCommand(cmd, LOG_LENGTH);
    expect(wire).toEqual({ type: "placeFirstBase", expectedLogIndex: LOG_LENGTH, hex: HEX });
  });

  test("build stamps expectedLogIndex and carries pieces", () => {
    const pieces = [{ type: "factory" as const, hex: HEX }];
    const wire = toClientCommand({ type: "build", pieces }, LOG_LENGTH);
    expect(wire).toEqual({ type: "build", expectedLogIndex: LOG_LENGTH, pieces });
  });

  test("attack stamps expectedLogIndex and carries decl", () => {
    const decl = { target: HEX, attackers: [HEX, HEX, HEX], defender: HEX };
    const wire = toClientCommand({ type: "attack", decl }, LOG_LENGTH);
    expect(wire).toEqual({ type: "attack", expectedLogIndex: LOG_LENGTH, decl });
  });

  test("endRound stamps expectedLogIndex", () => {
    expect(toClientCommand({ type: "endRound" }, LOG_LENGTH)).toEqual({ type: "endRound", expectedLogIndex: LOG_LENGTH });
  });

  test("pass stamps expectedLogIndex", () => {
    expect(toClientCommand({ type: "pass" }, LOG_LENGTH)).toEqual({ type: "pass", expectedLogIndex: LOG_LENGTH });
  });

  test("resolveDecision stamps expectedLogIndex and carries decisionId + defender", () => {
    const wire = toClientCommand({ type: "resolveDecision", decisionId: "d1", defender: HEX }, LOG_LENGTH);
    expect(wire).toEqual({ type: "resolveDecision", expectedLogIndex: LOG_LENGTH, decisionId: "d1", defender: HEX });
  });

  test("extendDecision carries decisionId and has NO expectedLogIndex", () => {
    const wire = toClientCommand({ type: "extendDecision", decisionId: "d1" }, LOG_LENGTH);
    expect(wire).toEqual({ type: "extendDecision", decisionId: "d1" });
    expect("expectedLogIndex" in wire).toBe(false);
  });

  test("every mutating command stamps the CURRENT logLength (varying)", () => {
    for (const len of [0, 1, 42]) {
      const mutating: DriverCommand[] = [
        { type: "placeFirstBase", hex: HEX },
        { type: "build", pieces: [{ type: "base", hex: HEX }] },
        { type: "attack", decl: { target: HEX, attackers: [HEX, HEX, HEX], defender: HEX } },
        { type: "endRound" },
        { type: "pass" },
        { type: "resolveDecision", decisionId: "d", defender: HEX },
      ];
      for (const cmd of mutating) {
        const wire = toClientCommand(cmd, len) as Extract<ClientCommand, { expectedLogIndex: number }>;
        expect(wire.expectedLogIndex).toBe(len);
      }
      // extendDecision never carries an index at any logLength.
      expect("expectedLogIndex" in toClientCommand({ type: "extendDecision", decisionId: "d" }, len)).toBe(false);
    }
  });
});

// ── toDriverEvent: one DriverEvent (or null) per ServerMessage ─────────────────────────────────────────────────
describe("toDriverEvent", () => {
  test("applied decodes the EncodedLogEntry (rng bigints) and carries events + logIndex", () => {
    // Ground truth: a real composed LogEntry, encoded to the wire form.
    const game = freshGame();
    const entry: LogEntry = { player: 0, kind: "placeFirstBase", hex: HEX, rngBeforeApply: game.rngState };
    const msg: ServerMessage = { type: "applied", entry: encodeEntry(entry), events: [], logIndex: 4 };

    const ev = toDriverEvent(msg);
    expect(ev?.type).toBe("applied");
    if (ev?.type !== "applied") throw new Error("expected applied");
    expect(ev.logIndex).toBe(4);
    expect(ev.entry).toEqual(entry); // DECODED entry == the original composed LogEntry
    expect(typeof ev.entry.rngBeforeApply.state).toBe("bigint"); // proves decodeEntry ran (not the wire string form)
    expect(typeof ev.entry.rngBeforeApply.inc).toBe("bigint");
    expect(ev.events).toBe(msg.events);
  });

  test("turnRollover carries order + ironWeights", () => {
    const msg: ServerMessage = { type: "turnRollover", order: [1, 0], ironWeights: [0.5, 0.5] };
    expect(toDriverEvent(msg)).toEqual({ type: "turnRollover", order: [1, 0], ironWeights: [0.5, 0.5] });
  });

  test("gameOver carries winners + cause", () => {
    const msg: ServerMessage = { type: "gameOver", winners: [0], cause: "iron" };
    expect(toDriverEvent(msg)).toEqual({ type: "gameOver", winners: [0], cause: "iron" });
  });

  test("prompt projects the EncodedPending to a DriverPending (drops kind)", () => {
    const pending = encodedPendingFixture();
    const ev = toDriverEvent({ type: "prompt", pending });
    expect(ev?.type).toBe("prompt");
    if (ev?.type !== "prompt") throw new Error("expected prompt");
    expect(ev.pending).toEqual({
      decisionId: "dec-1",
      round: 3,
      declaringPlayer: 0,
      promptedSeat: 1,
      target: pending.target,
      eligibleDefenders: pending.eligibleDefenders,
      deadlineEpochMs: null,
    });
    expect("kind" in ev.pending).toBe(false); // the domain-shaped pending drops the wire discriminator
  });

  test("error maps the code, passes the message VERBATIM, and carries currentLogIndex", () => {
    const msg: ServerMessage = { type: "error", code: "BUILD_OVER_BUDGET", message: "3 pieces exceeds build budget 1", currentLogIndex: 9 };
    const ev = toDriverEvent(msg);
    expect(ev).toEqual({ type: "rejected", code: "BUILD_OVER_BUDGET", message: "3 pieces exceeds build budget 1", currentLogIndex: 9 });
  });

  test("resync decodes the snapshot, projects pending, carries logLength + seats, and DROPS reason/versions", () => {
    const game = freshGame();
    const seats: SeatRosterEntry[] = [{ seat: 0, claimed: true, kind: "human" }, { seat: 1, claimed: false, kind: "human" }];
    const pending = encodedPendingFixture();
    const msg: ServerMessage = {
      type: "resync",
      snapshot: encodeState(game),
      logLength: 12,
      pending,
      seats,
      protocolVersion: 1,
      replayVersion: "test",
      reason: "STALE_INDEX",
    };
    const ev = toDriverEvent(msg);
    expect(ev?.type).toBe("sync");
    if (ev?.type !== "sync") throw new Error("expected sync");
    expect(ev.logLength).toBe(12);
    expect(ev.seats).toEqual(seats);
    expect(ev.snapshot).toEqual(game); // decodeState round-trips (rngState bigints restored)
    expect(typeof ev.snapshot.rngState.state).toBe("bigint");
    expect(ev.pending).toEqual({
      decisionId: "dec-1",
      round: 3,
      declaringPlayer: 0,
      promptedSeat: 1,
      target: pending.target,
      eligibleDefenders: pending.eligibleDefenders,
      deadlineEpochMs: null,
    });
    // reason / protocolVersion / replayVersion are NOT carried into the sync event.
    expect(Object.keys(ev).sort()).toEqual(["logLength", "pending", "seats", "snapshot", "type"]);
  });

  test("resync with a null pending yields a sync with a null pending", () => {
    const game = freshGame();
    const msg: ServerMessage = {
      type: "resync", snapshot: encodeState(game), logLength: 0,
      pending: null, seats: [], protocolVersion: 1, replayVersion: "test", reason: null,
    };
    const ev = toDriverEvent(msg);
    if (ev?.type !== "sync") throw new Error("expected sync");
    expect(ev.pending).toBeNull();
  });

  test("reload becomes a connection reload-required event", () => {
    expect(toDriverEvent({ type: "reload" })).toEqual({ type: "connection", status: "reload-required" });
  });

  test("seatClaimed is dropped (no DriverEvent counterpart)", () => {
    expect(toDriverEvent({ type: "seatClaimed", seat: 0, requestId: "r1" })).toBeNull();
  });
});

// ── WIRE_TO_DRIVER_ERROR: total over the wire catalog ─────────────────────────────────────────────────────────
describe("WIRE_TO_DRIVER_ERROR", () => {
  test("maps every WireErrorCode to a non-empty DriverErrorCode", () => {
    for (const code of WIRE_ERROR_CODES) {
      const mapped = WIRE_TO_DRIVER_ERROR[code];
      expect(mapped, code).toBeTypeOf("string");
      expect((mapped as string).length, code).toBeGreaterThan(0);
    }
  });

  test("has exactly one entry per wire code and no extras", () => {
    expect(Object.keys(WIRE_TO_DRIVER_ERROR).sort()).toEqual([...WIRE_ERROR_CODES].sort());
  });

  test("is the identity map (each wire code maps to its same-named driver code)", () => {
    for (const code of WIRE_ERROR_CODES) {
      expect(WIRE_TO_DRIVER_ERROR[code as WireErrorCode]).toBe(code);
    }
  });
});
