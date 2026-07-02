// ABOUTME: Agent-drive loop tests with a FAKE agent (isolates loop mechanics from real agent policy).
// ABOUTME: Pins the agent-drive invariant (spec §3): drive agent/eliminated rounds forward, logging each atomically.
import { test, expect } from "vitest";
import { currentActor, needsDrive, driveOneStep, commitEntries } from "../../src/session/agent-drive";
import { openSession } from "../../src/session/session";
import { logKey, SNAPSHOT_KEY } from "../../src/session/keys";
import { stateHash } from "../../src/session/hash";
import { representativeFirstBase } from "../../src/engine/turn";
import { defaultConfig } from "../../src/engine/config";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { Agent } from "../../src/agent/agent";
import type { SessionHeader, LogEntry } from "../../src/session/types";
import type { SessionState } from "../../src/session/session-types";

// Seed 1n gives a play-phase turn order of [0,1] (probed): the agent seat 0 is the
// first play-phase player, so the play-drive assertion drives an agent round without
// first having to step a human turn (which the loop cannot do).
const SEED = 1n;

/** 2-seat header: seat 0 = heuristic agent, seat 1 = human. allowPass so the pass round is rules-legitimate (DER #5). */
function header(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: SEED,
    config: { ...defaultConfig(), allowPass: true },
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "agent", agent: "heuristic" }, { kind: "human" }],
  };
}

/** A FAKE agent that always passes and makes NO draws — its returned state === the input state,
 *  so the entry's rngBeforeApply (choice.state.rngState) equals the pre-selection game rng. */
const passAgent: Agent = (state, _p) => ({ action: { kind: "pass" }, state });

function openAgentHumanSession(): SessionState {
  return openSession(header(), DEFAULT_ROOM_OPTIONS);
}

test("setup drive: agent seat auto-places one placeFirstBase, no snapshot, no round close, then halts at the human seat", () => {
  const s0 = openAgentHumanSession();

  // In setup the current actor is the setup-order placer, id-order [0,1] -> seat 0 (the agent).
  expect(s0.game.phase.turn).toBe(0);
  expect(currentActor(s0)).toBe(0);
  expect(needsDrive(s0)).toBe(true);

  // The expected placement hex is representativeFirstBase for seat 0 (setup does NOT consult the agent).
  const expectedHex = representativeFirstBase(s0.game, 0);

  const res = driveOneStep(s0, () => passAgent);

  // Exactly one round closed neither (placeFirstBase never closes a round) nor snapshotted.
  expect(res.advanced).toBe(false);
  expect(res.terminal).toBeNull();

  // Exactly ONE log:N key, at index 0, and NO snapshot key.
  const put = res.effects.persist!.put;
  const logKeys = Object.keys(put).filter((k) => k.startsWith("log:"));
  expect(logKeys).toEqual([logKey(0)]);
  expect(Object.keys(put)).not.toContain(SNAPSHOT_KEY);

  // The persisted RAW entry is the agent seat's placeFirstBase via representativeFirstBase.
  const rawEntry = put[logKey(0)] as LogEntry;
  expect(rawEntry.kind).toBe("placeFirstBase");
  expect(rawEntry.player).toBe(0);
  expect(rawEntry).toMatchObject({ kind: "placeFirstBase", player: 0, hex: expectedHex });

  // Exactly one `applied` broadcast, at the matching logIndex, and NO turnRollover / gameOver (round not closed).
  expect(res.effects.broadcast).toHaveLength(1);
  const b0 = res.effects.broadcast[0]!;
  expect(b0.type).toBe("applied");
  expect(b0).toMatchObject({ type: "applied", logIndex: 0 });

  // Session logLength advanced by exactly one; still in setup.
  expect(res.next.logLength).toBe(1);
  expect(res.next.game.phase.turn).toBe(0);

  // Now the human seat is the placer -> the drive HALTS (that is the whole point).
  expect(currentActor(res.next)).toBe(1);
  expect(needsDrive(res.next)).toBe(false);
});

test("play drive: a fake pass-agent round closes the round — one pass entry + snapshot + turnRollover(ironWeights:null)", () => {
  const s0 = openAgentHumanSession();

  // Setup: agent seat 0 auto-places via the loop.
  const afterAgentSetup = driveOneStep(s0, () => passAgent).next;
  expect(currentActor(afterAgentSetup)).toBe(1); // human's setup placement now

  // Manually apply the human's placeFirstBase through the exported shared builder to finish setup.
  const humanHex = representativeFirstBase(afterAgentSetup.game, 1);
  const humanPlace: LogEntry = {
    player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: afterAgentSetup.game.rngState,
  };
  const afterSetup = commitEntries(afterAgentSetup, [humanPlace]).next;

  // Setup complete -> play phase; seed 1n puts the agent (seat 0) first.
  expect(afterSetup.game.phase.turn).toBe(1);
  expect(currentActor(afterSetup)).toBe(0);
  expect(needsDrive(afterSetup)).toBe(true);

  const res = driveOneStep(afterSetup, () => passAgent);

  // A pass closes the round.
  expect(res.advanced).toBe(true);
  expect(res.terminal).toBeNull();

  const put = res.effects.persist!.put;

  // Exactly ONE log:N key (the pass), at index 2 (0=agent place, 1=human place, 2=agent pass).
  const logKeys = Object.keys(put).filter((k) => k.startsWith("log:"));
  expect(logKeys).toEqual([logKey(2)]);
  const rawEntry = put[logKey(2)] as LogEntry;
  expect(rawEntry).toMatchObject({ kind: "pass", player: 0 });
  // The fake agent makes no draws, so rngBeforeApply is the pre-selection game rng.
  expect(rawEntry.rngBeforeApply).toEqual(afterSetup.game.rngState);

  // Round closed -> a SNAPSHOT is present, holding the post-advanceRound state.
  expect(Object.keys(put)).toContain(SNAPSHOT_KEY);
  const snap = put[SNAPSHOT_KEY] as { state: unknown; logIndex: number; stateHash: string; replayVersion: string };
  expect(snap.logIndex).toBe(2);
  expect(snap.stateHash).toBe(stateHash(res.next.game));
  expect(snap.replayVersion).toBe("test");

  // Broadcasts: the `applied` pass, then a `turnRollover` with ironWeights null and the post-advance order.
  expect(res.effects.broadcast).toHaveLength(2);
  const applied = res.effects.broadcast[0]!;
  expect(applied).toMatchObject({ type: "applied", logIndex: 2 });
  const rollover = res.effects.broadcast[1]!;
  expect(rollover).toEqual({ type: "turnRollover", order: res.next.game.phase.order, ironWeights: null });
  // No gameOver on an ongoing round.
  expect(res.effects.broadcast.some((m) => m.type === "gameOver")).toBe(false);

  expect(res.next.logLength).toBe(3);
});

test("needsDrive guards: false when a decision is pending, false at a human actor's play-phase turn", () => {
  const s0 = openAgentHumanSession();

  // Reach play phase with the agent (seat 0) current.
  const afterAgentSetup = driveOneStep(s0, () => passAgent).next;
  const humanHex = representativeFirstBase(afterAgentSetup.game, 1);
  const afterSetup = commitEntries(afterAgentSetup, [
    { player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: afterAgentSetup.game.rngState },
  ]).next;
  expect(currentActor(afterSetup)).toBe(0);
  expect(needsDrive(afterSetup)).toBe(true); // baseline: agent actor, no pending -> drive

  // Guard 1: a non-null pending suppresses the drive, even at an agent actor.
  const withPending: SessionState = {
    ...afterSetup,
    pending: {
      decisionId: "d-test",
      kind: "defenderChoice",
      round: afterSetup.game.phase.turn,
      declaringPlayer: 0,
      promptedSeat: 1,
      proposed: { target: humanHex, attackers: [], defender: humanHex },
      preDecisionLogLength: afterSetup.logLength,
      rngBeforeApply: afterSetup.game.rngState,
      deadlineEpochMs: null,
    },
  };
  expect(needsDrive(withPending)).toBe(false);

  // Guard 2: after the agent passes, seat 1 (human) is current -> no drive.
  const afterAgentPass = driveOneStep(afterSetup, () => passAgent).next;
  expect(currentActor(afterAgentPass)).toBe(1);
  expect(afterAgentPass.header.seats[1]!.kind).toBe("human");
  expect(needsDrive(afterAgentPass)).toBe(false);
});

test("logKey continuity: consecutive driveOneStep/commitEntries calls produce a gapless log:N sequence", () => {
  let s = openAgentHumanSession();
  const collected: string[] = [];

  // Setup step: agent seat 0 auto-places (log:000000).
  const step0 = driveOneStep(s, () => passAgent);
  collected.push(...Object.keys(step0.effects.persist!.put).filter((k) => k.startsWith("log:")));
  s = step0.next;

  // Human placement via the shared builder (log:000001).
  const humanHex = representativeFirstBase(s.game, 1);
  const step1 = commitEntries(s, [
    { player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: s.game.rngState },
  ]);
  collected.push(...Object.keys(step1.effects.persist!.put).filter((k) => k.startsWith("log:")));
  s = step1.next;

  // Agent play round: pass (log:000002).
  const step2 = driveOneStep(s, () => passAgent);
  collected.push(...Object.keys(step2.effects.persist!.put).filter((k) => k.startsWith("log:")));
  s = step2.next;

  expect(collected).toEqual([logKey(0), logKey(1), logKey(2)]);
});

test("broadcast/persist coherence: every applied broadcast's logIndex has a matching log:N key in the same put", () => {
  const s0 = openAgentHumanSession();

  // Drive the agent's setup placement — one applied broadcast, one log key.
  const setupStep = driveOneStep(s0, () => passAgent);
  assertAppliedCoherence(setupStep.effects);

  // Advance past setup, then drive the agent's play-phase pass — an applied + a rollover.
  const humanHex = representativeFirstBase(setupStep.next.game, 1);
  const afterSetup = commitEntries(setupStep.next, [
    { player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: setupStep.next.game.rngState },
  ]).next;
  const playStep = driveOneStep(afterSetup, () => passAgent);
  assertAppliedCoherence(playStep.effects);
});

/** Mechanism assertion: for every `applied` broadcast, its logIndex maps to a persisted log:N key in the same effects. */
function assertAppliedCoherence(effects: { persist: { put: Record<string, unknown> } | null; broadcast: { type: string }[] }): void {
  const put = effects.persist!.put;
  const appliedIndexes = effects.broadcast
    .filter((m): m is { type: "applied"; logIndex: number } => m.type === "applied")
    .map((m) => m.logIndex);
  expect(appliedIndexes.length).toBeGreaterThan(0);
  for (const idx of appliedIndexes) {
    expect(Object.keys(put)).toContain(logKey(idx));
  }
}

test("driveOneStep throws for an agent attack round (deferred to Phase A4)", () => {
  const s0 = openAgentHumanSession();
  // Reach play phase with the agent current.
  const afterAgentSetup = driveOneStep(s0, () => passAgent).next;
  const humanHex = representativeFirstBase(afterAgentSetup.game, 1);
  const afterSetup = commitEntries(afterAgentSetup, [
    { player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: afterAgentSetup.game.rngState },
  ]).next;

  // A fake agent that declares an attack — the loop must reject it (A4 territory).
  const attackAgent: Agent = (state, _p) => ({
    action: { kind: "attack", attacks: [{ target: humanHex, attackers: [], defender: humanHex }] },
    state,
  });
  expect(() => driveOneStep(afterSetup, () => attackAgent)).toThrow(/agent attack rounds are implemented in Phase A4/);
});
