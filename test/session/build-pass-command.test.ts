// ABOUTME: build + pass commands (A3.3) — validateBuildPieces/validatePass mapping, engine budget/placement throws
// ABOUTME: mapped at apply time, shared commitEntries persistence (log:NNNNNN + SNAPSHOT_KEY — build/pass self-close).
import { test, expect } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { logKey, SNAPSHOT_KEY } from "../../src/session/keys";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { defaultConfig } from "../../src/engine/config";
import { legalFirstBaseHexes, buildBudget, legalActions } from "../../src/index";
import type { RuleConfig } from "../../src/index";
import { stateHash } from "../../src/session/hash";
import type { SessionHeader, Piece } from "../../src/session/types";
import type { CommandCtx, SessionState } from "../../src/session/session-types";
import type { Hex } from "../../src/engine/types";

// A 2-HUMAN header on a fixed seed: no agent-drive interferes. allowPass follows the config we pass in.
const mkHeader = (config: RuleConfig = defaultConfig()): SessionHeader => ({
  formatVersion: 1,
  replayVersion: "test",
  seed: 42n,
  config,
  boardSource: { kind: "generate", size: 96, ironCount: 14 },
  seats: [{ kind: "human" }, { kind: "human" }],
});

const mkCtx = (actingSeat: number): CommandCtx => ({
  actingSeat,
  nowEpochMs: 1_000_000,
  decisionId: "test-decision",
});

/** The seat whose turn it currently is, derived from phase.order/indexInOrder (setup placer or current player). */
function currentSeat(s: SessionState): number {
  return s.game.phase.order[s.game.phase.indexInOrder]!;
}

/**
 * Run both seats' setup placements so the returned session is in the PLAY phase (turn 1). Each seat places
 * its first legal outermost-ring hex; the engine auto-advances to turn 1 on the final placement.
 */
function completeSetup(config: RuleConfig = defaultConfig()): SessionState {
  let s = openSession(mkHeader(config), DEFAULT_ROOM_OPTIONS);
  let idx = 0;
  while (s.game.phase.turn === 0) {
    const seat = currentSeat(s);
    const hex = legalFirstBaseHexes(s.game)[0]!;
    const r = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: idx, hex }, mkCtx(seat));
    if (r.effects.persist === null) throw new Error(`setup placement rejected at idx ${idx}`);
    s = r.next;
    idx += 1;
  }
  return s;
}

/** The current player's first single-piece FACTORY build from legalActions (post-setup a founding player is
 *  bootstrap-only → the only legal builds are single factories). Returns the pieces array. */
function firstLegalFactoryBuild(s: SessionState): Piece[] {
  const player = s.game.phase.order[s.game.phase.indexInOrder]!;
  const actions = legalActions(s.game);
  const build = actions.find(
    (a) => a.kind === "build" && a.pieces.length === 1 && a.pieces[0]!.type === "factory",
  );
  if (build === undefined || build.kind !== "build") {
    throw new Error(`no legal factory build for player ${player}`);
  }
  return build.pieces.map((p) => ({ type: p.type, hex: p.hex }));
}

test("legal build: the acting player builds an affordable factory — persists log:N + SNAPSHOT_KEY, applied + turnRollover, snapshot correct", () => {
  const s = completeSetup();
  const seat = s.game.phase.order[s.game.phase.indexInOrder]!;
  const budget = buildBudget(s.game, seat);
  expect(budget).toBeGreaterThanOrEqual(1); // a founding single-base player controls >=1 iron → bootstrap +1
  const pieces = firstLegalFactoryBuild(s);
  expect(pieces.length).toBeLessThanOrEqual(budget);

  const idx = s.logLength;
  const { next, effects } = applyCommand(s, { type: "build", expectedLogIndex: idx, pieces }, mkCtx(seat));

  // Build self-closes the round → persist carries EXACTLY the log entry AND the snapshot, nothing else.
  expect(effects.persist).not.toBeNull();
  const putKeys = Object.keys(effects.persist!.put).sort();
  expect(putKeys).toEqual([SNAPSHOT_KEY, logKey(idx)].sort());

  // Broadcast: applied (the build) then turnRollover (self-close), ironWeights null (A6 fills it).
  expect(effects.broadcast).toHaveLength(2);
  const applied = effects.broadcast[0]!;
  expect(applied.type).toBe("applied");
  if (applied.type !== "applied") throw new Error("expected applied");
  expect(applied.logIndex).toBe(idx);
  expect(applied.entry.kind).toBe("build");
  const rollover = effects.broadcast[1]!;
  expect(rollover.type).toBe("turnRollover");
  if (rollover.type !== "turnRollover") throw new Error("expected turnRollover");
  expect(rollover.ironWeights).toBeNull();
  expect(rollover.order).toEqual(next.game.phase.order);

  // logLength advanced by exactly one entry.
  expect(next.logLength).toBe(idx + 1);

  // Snapshot payload: logIndex == the entry index, stateHash recomputed from the post-close state.
  const snapshot = effects.persist!.put[SNAPSHOT_KEY] as { state: typeof next.game; logIndex: number; stateHash: string };
  expect(snapshot.logIndex).toBe(idx);
  expect(snapshot.stateHash).toBe(stateHash(next.game));
});

test("MIXED_PIECE_TYPES: a build mixing base + factory pieces is rejected before the entry is built — no persist, next === s", () => {
  const s = completeSetup();
  const seat = s.game.phase.order[s.game.phase.indexInOrder]!;
  const board = s.game.board.hexes;
  const mixed: Piece[] = [
    { type: "factory", hex: board[0]! },
    { type: "base", hex: board[1]! },
  ];

  const { next, effects } = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: mixed }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("MIXED_PIECE_TYPES");
});

test("DUP_PIECES: a build with duplicate hex+type is rejected before the entry is built — no persist, next === s", () => {
  const s = completeSetup();
  const seat = s.game.phase.order[s.game.phase.indexInOrder]!;
  const h: Hex = s.game.board.hexes[0]!;
  const dup: Piece[] = [
    { type: "factory", hex: h },
    { type: "factory", hex: h },
  ];

  const { next, effects } = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: dup }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("DUP_PIECES");
});

test("BUILD_OVER_BUDGET: more legal factory pieces than the budget allows is rejected at apply — no persist, next === s", () => {
  const s = completeSetup();
  const seat = s.game.phase.order[s.game.phase.indexInOrder]!;
  const budget = buildBudget(s.game, seat);

  // Collect (budget + 1) DISTINCT legal single-factory placements — each is individually legal, so the ONLY
  // rule they violate collectively is the budget cap. This pins the catch-path over-budget mapping.
  const factoryPlacements = legalActions(s.game)
    .filter((a): a is Extract<typeof a, { kind: "build" }> => a.kind === "build")
    .filter((a) => a.pieces.length === 1 && a.pieces[0]!.type === "factory")
    .map((a) => a.pieces[0]!);
  expect(factoryPlacements.length).toBeGreaterThan(budget); // enough distinct legal hexes to overshoot
  const pieces: Piece[] = factoryPlacements.slice(0, budget + 1).map((p) => ({ type: p.type, hex: p.hex }));
  expect(pieces.length).toBe(budget + 1);

  const { next, effects } = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("BUILD_OVER_BUDGET");
});

test("PASS_NOT_FORCED: a non-forced pass with allowPass=false is rejected — no persist, next === s", () => {
  // A fresh post-setup founding player has a legal factory build (bootstrap +1), so pass is NOT the only legal
  // action → validatePass returns PASS_NOT_FORCED under the default config (allowPass=false).
  const s = completeSetup();
  const seat = s.game.phase.order[s.game.phase.indexInOrder]!;

  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: s.logLength }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("PASS_NOT_FORCED");
});

test("legal pass (allowPass=true): the acting player passes — persists log:N + SNAPSHOT_KEY, applied + turnRollover, round closes", () => {
  const config: RuleConfig = { ...defaultConfig(), allowPass: true };
  const s = completeSetup(config);
  const seat = s.game.phase.order[s.game.phase.indexInOrder]!;
  const idx = s.logLength;

  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: idx }, mkCtx(seat));

  expect(effects.persist).not.toBeNull();
  const putKeys = Object.keys(effects.persist!.put).sort();
  expect(putKeys).toEqual([SNAPSHOT_KEY, logKey(idx)].sort());

  expect(effects.broadcast).toHaveLength(2);
  const applied = effects.broadcast[0]!;
  expect(applied.type).toBe("applied");
  if (applied.type !== "applied") throw new Error("expected applied");
  expect(applied.entry.kind).toBe("pass");
  const rollover = effects.broadcast[1]!;
  expect(rollover.type).toBe("turnRollover");
  if (rollover.type !== "turnRollover") throw new Error("expected turnRollover");
  expect(rollover.ironWeights).toBeNull();

  expect(next.logLength).toBe(idx + 1);
  const snapshot = effects.persist!.put[SNAPSHOT_KEY] as { logIndex: number; stateHash: string };
  expect(snapshot.logIndex).toBe(idx);
  expect(snapshot.stateHash).toBe(stateHash(next.game));
});

// A 4-HUMAN header: setup has 4 placements, so after two placements the game is STILL in setup (turn 0) with
// >=2 live coalitions — the state where a setup-phase pass/build from the current (unplaced) placer must be
// envelope-rejected, not forwarded to the engine (advanceRound throws on any turn-0 state, turn.ts:246).
const mkHeader4 = (): SessionHeader => ({
  formatVersion: 1,
  replayVersion: "test",
  seed: 42n,
  config: defaultConfig(),
  boardSource: { kind: "generate", size: 96, ironCount: 14 },
  seats: [{ kind: "human" }, { kind: "human" }, { kind: "human" }, { kind: "human" }],
});

/** A 4-player session with exactly the first TWO setup placements done: still turn 0, next placer has 0 bases. */
function midSetup4(): SessionState {
  let s = openSession(mkHeader4(), DEFAULT_ROOM_OPTIONS);
  for (let idx = 0; idx < 2; idx++) {
    const seat = currentSeat(s);
    const hex = legalFirstBaseHexes(s.game)[0]!;
    const r = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: idx, hex }, mkCtx(seat));
    if (r.effects.persist === null) throw new Error(`setup placement rejected at idx ${idx}`);
    s = r.next;
  }
  expect(s.game.phase.turn).toBe(0); // still setup — two of four seats placed
  return s;
}

test("SETUP_PLACEMENT_REQUIRED: a setup-phase pass from the current unplaced placer is rejected, not crashed", () => {
  // The crash repro: with >=2 live coalitions already placed, validatePass sees the unplaced placer as
  // FORCED (legalActions' stuck fallback returns only pass — no bases → no builds/attacks), so without an
  // envelope guard the entry reaches applyEntry → applyEliminations(noBases) → status ongoing →
  // advanceRound, which THROWS on turn 0 (turn.ts:246) — uncaught through applyCommand.
  const s = midSetup4();
  const seat = currentSeat(s);
  expect(s.game.bases.some((b) => b.owner === seat)).toBe(false); // the placer has NOT placed yet

  const { next, effects } = applyCommand(s, { type: "pass", expectedLogIndex: s.logLength }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("SETUP_PLACEMENT_REQUIRED");
  expect(reply.currentLogIndex).toBe(s.logLength);
});

test("SETUP_PLACEMENT_REQUIRED: a setup-phase build from the current unplaced placer is rejected", () => {
  // Same envelope hole, build flavor: during setup the ONLY legal mutating command is placeFirstBase.
  // Without the guard this build reached the engine's apply path (turn-0 phase semantics are wrong there —
  // the mapped budget throw fires incidentally, teaching the client the wrong rule).
  const s = midSetup4();
  const seat = currentSeat(s);
  const pieces: Piece[] = [{ type: "factory", hex: s.game.board.hexes[0]! }]; // well-formed; setup makes it illegal

  const { next, effects } = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces }, mkCtx(seat));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("SETUP_PLACEMENT_REQUIRED");
});

test("play-phase NOT_YOUR_TURN: the NON-current player sends a well-formed build → NOT_YOUR_TURN", () => {
  // Exercises the envelope's currentPlayer branch IN THE PLAY PHASE (previously only setup-phase tested):
  // currentActor() resolves to currentPlayer(game) when phase.turn !== 0. The non-current seat is rejected
  // by the envelope guard BEFORE any validation/engine work.
  const s = completeSetup();
  const current = s.game.phase.order[s.game.phase.indexInOrder]!;
  const other = current === 0 ? 1 : 0;
  const pieces = firstLegalFactoryBuild(s); // a perfectly well-formed build; only the actor is wrong

  const { next, effects } = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces }, mkCtx(other));

  expect(next).toBe(s);
  expect(effects.persist).toBeNull();
  expect(effects.reply).toHaveLength(1);
  const reply = effects.reply[0]!;
  expect(reply.type).toBe("error");
  if (reply.type !== "error") throw new Error("expected error");
  expect(reply.code).toBe("NOT_YOUR_TURN");
  expect(reply.currentLogIndex).toBe(s.logLength);
});
