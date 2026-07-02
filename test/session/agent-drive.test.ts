// ABOUTME: Agent-drive loop tests with a FAKE agent (isolates loop mechanics from real agent policy).
// ABOUTME: Pins the agent-drive invariant (spec §3): drive agent/eliminated rounds forward, logging each atomically.
import { test, expect, describe } from "vitest";
import { currentActor, needsDrive, driveOneStep, commitEntries } from "../../src/session/agent-drive";
import { openSession, applyCommand } from "../../src/session/session";
import { agentForSeat } from "../../src/session/agent-binding";
import { logKey, PENDING_KEY, SNAPSHOT_KEY } from "../../src/session/keys";
import { stateHash } from "../../src/session/hash";
import { representativeFirstBase } from "../../src/engine/turn";
import { representativeDefender } from "../../src/engine/legal";
import { control } from "../../src/engine/control";
import { status } from "../../src/engine/status";
import { legalFirstBaseHexes } from "../../src/index";
import { applyEntry } from "../../src/session/round";
import { defaultConfig } from "../../src/engine/config";
import { nextInt, seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { Agent } from "../../src/agent/agent";
import type { ServerMessage } from "../../src/wire/protocol";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";
import type { SessionHeader, LogEntry, SeatConfig } from "../../src/session/types";
import type { SessionState, CommandCtx } from "../../src/session/session-types";

// Host-supplied ids for the attack branch's openDefenderDecision (the reducer stays pure — the host injects
// nowEpochMs + decisionId per wake). The drive tests that never open a pending never read these.
const IDS = { nowEpochMs: 1_000_000, decisionId: "test-decision" };

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

  const res = driveOneStep(s0, () => passAgent, IDS);

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

test("play drive: a fake pass-agent round closes the round — one pass entry + snapshot + turnRollover(ironWeights, A6.3)", () => {
  const s0 = openAgentHumanSession();

  // Setup: agent seat 0 auto-places via the loop.
  const afterAgentSetup = driveOneStep(s0, () => passAgent, IDS).next;
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

  const res = driveOneStep(afterSetup, () => passAgent, IDS);

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

  // Broadcasts: the `applied` pass, then a `turnRollover` with the post-advance order and (this is a 2-player
  // game) a non-null ironWeights matching an independently recomputed control() on the post-close state
  // (A6.3 — the iron-weight mechanism itself is exhaustively covered by turn-rollover.test.ts; this test only
  // pins that the agent-drive loop's turnRollover carries it).
  expect(res.effects.broadcast).toHaveLength(2);
  const applied = res.effects.broadcast[0]!;
  expect(applied).toMatchObject({ type: "applied", logIndex: 2 });
  const rollover = res.effects.broadcast[1]!;
  if (rollover.type !== "turnRollover") throw new Error("expected turnRollover");
  expect(rollover.order).toEqual(res.next.game.phase.order);
  expect(rollover.ironWeights).toEqual([control(res.next.game, 0).iron.length, control(res.next.game, 1).iron.length]);
  // No gameOver on an ongoing round.
  expect(res.effects.broadcast.some((m) => m.type === "gameOver")).toBe(false);

  expect(res.next.logLength).toBe(3);
});

test("needsDrive guards: false when a decision is pending, false at a human actor's play-phase turn", () => {
  const s0 = openAgentHumanSession();

  // Reach play phase with the agent (seat 0) current.
  const afterAgentSetup = driveOneStep(s0, () => passAgent, IDS).next;
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
  const afterAgentPass = driveOneStep(afterSetup, () => passAgent, IDS).next;
  expect(currentActor(afterAgentPass)).toBe(1);
  expect(afterAgentPass.header.seats[1]!.kind).toBe("human");
  expect(needsDrive(afterAgentPass)).toBe(false);
});

test("logKey continuity: consecutive driveOneStep/commitEntries calls produce a gapless log:N sequence", () => {
  let s = openAgentHumanSession();
  const collected: string[] = [];

  // Setup step: agent seat 0 auto-places (log:000000).
  const step0 = driveOneStep(s, () => passAgent, IDS);
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
  const step2 = driveOneStep(s, () => passAgent, IDS);
  collected.push(...Object.keys(step2.effects.persist!.put).filter((k) => k.startsWith("log:")));
  s = step2.next;

  expect(collected).toEqual([logKey(0), logKey(1), logKey(2)]);
});

test("broadcast/persist coherence: every applied broadcast's logIndex has a matching log:N key in the same put", () => {
  const s0 = openAgentHumanSession();

  // Drive the agent's setup placement — one applied broadcast, one log key.
  const setupStep = driveOneStep(s0, () => passAgent, IDS);
  assertAppliedCoherence(setupStep.effects);

  // Advance past setup, then drive the agent's play-phase pass — an applied + a rollover.
  const humanHex = representativeFirstBase(setupStep.next.game, 1);
  const afterSetup = commitEntries(setupStep.next, [
    { player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: setupStep.next.game.rngState },
  ]).next;
  const playStep = driveOneStep(afterSetup, () => passAgent, IDS);
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

test("rngBeforeApply is the agent-RETURNED (post-selection) rng, not the pre-selection game rng", () => {
  const s0 = openAgentHumanSession();

  // Reach play phase with the agent (seat 0) current.
  const afterAgentSetup = driveOneStep(s0, () => passAgent, IDS).next;
  const humanHex = representativeFirstBase(afterAgentSetup.game, 1);
  const afterSetup = commitEntries(afterAgentSetup, [
    { player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: afterAgentSetup.game.rngState },
  ]).next;
  expect(currentActor(afterSetup)).toBe(0);

  // A fake agent that makes a DRAW during selection, so its returned state carries an ADVANCED rng.
  // This discriminates the capture point — the no-draw passAgent (returned state === input state)
  // cannot tell `choice.state.rngState` (correct) apart from `s.game.rngState` (regression).
  const drawingPassAgent: Agent = (state, _p) => ({
    action: { kind: "pass" },
    state: { ...state, rngState: nextInt(state.rngState, 1000).state },
  });

  const preSelectionRng = afterSetup.game.rngState;
  const expectedPostSelectionRng = nextInt(preSelectionRng, 1000).state;
  // Sanity: the draw actually advanced the rng, or the two assertions below would collapse into one.
  expect(expectedPostSelectionRng).not.toEqual(preSelectionRng);

  const res = driveOneStep(afterSetup, () => drawingPassAgent, IDS);

  const put = res.effects.persist!.put;
  const rawEntry = put[logKey(2)] as LogEntry;
  expect(rawEntry.kind).toBe("pass");
  // The capture point is POST-selection: the agent-returned state's rng — never the pre-selection game rng.
  expect(rawEntry.rngBeforeApply).toEqual(expectedPostSelectionRng);
  expect(rawEntry.rngBeforeApply).not.toEqual(preSelectionRng);

  // End-to-end: the entry applies cleanly (applyEntry installs rngBeforeApply; a pass makes no draws
  // before the round-close order draw) and the round closes normally.
  expect(res.advanced).toBe(true);
  expect(res.terminal).toBeNull();
  expect(res.next.logLength).toBe(3);
});

// ===========================================================================
// chainAttacker invariant: "cleared on any round close" (session-types.ts). A
// pre-set chain is reachable in the drive: agent attacks a human, the
// resolution leaves the round OPEN (attacker still has a legal attack), the
// host re-drives, and the agent's policy picks build/pass — or the attacker
// was eliminated mid-chain and the drive lands roundSkipped. Every close path
// through driveOneStep must clear it (commitEntries' {...s} spread carries the
// old value).
// ===========================================================================

describe("driveOneStep clears chainAttacker on every round close", () => {
  /** Play-phase state with the agent (seat 0) current and a dangling open chain simulated. */
  function playStateWithChain(): SessionState {
    const s0 = openAgentHumanSession();
    const afterAgentSetup = driveOneStep(s0, () => passAgent, IDS).next;
    const humanHex = representativeFirstBase(afterAgentSetup.game, 1);
    const afterSetup = commitEntries(afterAgentSetup, [
      { player: 1, kind: "placeFirstBase", hex: humanHex, rngBeforeApply: afterAgentSetup.game.rngState },
    ]).next;
    expect(currentActor(afterSetup)).toBe(0);
    return { ...afterSetup, chainAttacker: 0 };
  }

  test("pass close clears a pre-set chainAttacker", () => {
    const s = playStateWithChain();
    const res = driveOneStep(s, () => passAgent, IDS);
    expect(res.advanced).toBe(true); // the pass closed the round
    expect(res.next.chainAttacker).toBeNull();
  });

  test("build close clears a pre-set chainAttacker", () => {
    const s = playStateWithChain();
    // The REAL heuristic agent at this seed-1n position deterministically picks a round-closing build.
    const res = driveOneStep(s, agentForSeat, IDS);
    const put = res.effects.persist!.put;
    const entry = Object.entries(put).find(([k]) => k.startsWith("log:"))![1] as LogEntry;
    expect(entry.kind).toBe("build"); // pins the fixture — this test exercises the build branch
    expect(res.advanced).toBe(true);
    expect(res.next.chainAttacker).toBeNull();
  });

  test("roundSkipped close clears a pre-set chainAttacker (attacker eliminated mid-chain)", () => {
    const withChain = playStateWithChain();
    // Eliminate the current player (the chain's attacker). In this 2-player game the skip's round close is a
    // last-standing victory (terminal) — advanced is true on a terminal close too, so the clear must still fire.
    const s: SessionState = {
      ...withChain,
      game: {
        ...withChain.game,
        players: withChain.game.players.map((pl) => (pl.id === 0 ? { ...pl, eliminated: true } : pl)),
      },
    };
    const res = driveOneStep(s, () => passAgent, IDS);
    const put = res.effects.persist!.put;
    const entry = Object.entries(put).find(([k]) => k.startsWith("log:"))![1] as LogEntry;
    expect(entry.kind).toBe("roundSkipped"); // pins the fixture — the eliminated-actor branch
    expect(res.advanced).toBe(true);
    expect(res.terminal).not.toBeNull(); // 2p: the sole live coalition wins at the close
    expect(res.next.chainAttacker).toBeNull();
  });
});

// ===========================================================================
// A4.4 — the agent attack branch. Synthetic boards (auto-close.test.ts pattern):
// a real attack applied via commitEntries runs applyEliminations after every
// entry, so every surviving player needs iron ON one of its own base hexes
// (testing-pitfalls §8) or it is wiped out mid-test by the noIron check.
// ===========================================================================

const SYNTH_CONFIG = defaultConfig();

/** A valid cube-coordinate hex (x+y+z=0). */
function hex(x: number, y: number): Hex {
  return { x, y, z: -x - y };
}

/** A fresh base literal (mirrors auto-close.test.ts's `base`). */
function base(owner: PlayerId, h: Hex, order: number, state: Base["state"] = "fresh"): Base {
  return { owner, hex: h, state, order };
}

/** A minimal synthetic GameState (mirrors auto-close.test.ts's synthGame). */
function synthGame(bases: Base[], opts?: { rng?: RngState; turn?: number; nPlayers?: number; iron?: Hex[] }): GameState {
  const nPlayers = opts?.nPlayers ?? 2;
  const allHexes = new Set<string>();
  const hexes: Hex[] = [];
  for (let x = -6; x <= 6; x++) {
    for (let y = -6; y <= 6; y++) {
      const h = hex(x, y);
      if (Math.abs(h.z) <= 6 && !allHexes.has(key(h))) {
        allHexes.add(key(h));
        hexes.push(h);
      }
    }
  }
  return {
    board: { hexes, iron: opts?.iron ?? [] },
    bases,
    factories: [],
    players: Array.from({ length: nPlayers }, (_, id) => ({ id, basesInHand: 12, alliance: [id], eliminated: false })),
    phase: { turn: opts?.turn ?? 3, order: Array.from({ length: nPlayers }, (_, i) => i), indexInOrder: 0 },
    factorySupply: 36,
    config: SYNTH_CONFIG,
    rngState: opts?.rng ?? seed(1n),
  };
}

/** A SessionState over a synthetic game with the given seat kinds. Non-zero logLength so log:N keys are unambiguous. */
function synthSession(game: GameState, seatKinds: SeatConfig[]): SessionState {
  const hdr: SessionHeader = {
    formatVersion: 1,
    replayVersion: "test",
    seed: 42n,
    config: SYNTH_CONFIG,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: seatKinds,
  };
  const s = openSession(hdr, DEFAULT_ROOM_OPTIONS);
  return { ...s, game, logLength: 7 };
}

// A synthetic attack position — player 0 (attacker) commits its ONLY 3 fresh bases against player 1's target T,
// so no legal attack remains post-attack and the agent path's endRound closes the round. Iron ON each side's own
// base hex keeps both alive through the real attack (testing-pitfalls §8).
const T = hex(0, 0);
const DEF_A = hex(-1, 0);
const ATTACKERS: Hex[] = [hex(1, 0), hex(2, -1), hex(0, 2)];
const IRON: Hex[] = [ATTACKERS[0]!, DEF_A];

function attackBases(): Base[] {
  return [
    base(1, T, 0),
    base(1, DEF_A, 1),
    base(0, ATTACKERS[0]!, 2),
    base(0, ATTACKERS[1]!, 3),
    base(0, ATTACKERS[2]!, 4),
  ];
}

/** A fake agent that returns a legal single-declaration attack on T, defender field left to representativeDefender. */
function attackAgentOnT(defenderPlaceholder: Hex): Agent {
  return (state, _p) => ({
    action: { kind: "attack", attacks: [{ target: T, attackers: ATTACKERS, defender: defenderPlaceholder }] },
    state,
  });
}

describe("driveOneStep — agent attack, agent/auto defender", () => {
  test("ONE atomic put: attack log:N (defender substituted) + endRound log:N+1 + snapshot + rollover", () => {
    const pre = synthGame(attackBases(), { iron: IRON });
    // Both seats agent so the defender (seat 1) is auto — the attack applies immediately (no pending).
    const s = synthSession(pre, [{ kind: "agent", agent: "heuristic" }, { kind: "agent", agent: "heuristic" }]);

    // The agent proposes a bogus defender; the drive MUST substitute representativeDefender's deterministic pick.
    const bogusDefender = hex(5, 0);
    const expectedDefender = representativeDefender(pre, T, 1);
    expect(expectedDefender).not.toBeNull();
    expect(key(expectedDefender!)).not.toBe(key(bogusDefender)); // substitution is observable

    const res = driveOneStep(s, () => attackAgentOnT(bogusDefender), IDS);

    // The round closed (endRound always appended) — snapshot + turnRollover, no gameOver on an ongoing game.
    expect(res.advanced).toBe(true);
    expect(res.terminal).toBeNull();

    const put = res.effects.persist!.put;
    // BOTH entries in ONE put: attack at log:7, endRound at log:8, plus the snapshot; NO pending key.
    const logKeys = Object.keys(put).filter((k) => k.startsWith("log:"));
    expect(logKeys).toEqual([logKey(7), logKey(8)]);
    expect(Object.keys(put)).toContain(SNAPSHOT_KEY);
    expect(Object.keys(put)).not.toContain(PENDING_KEY);

    const attackEntry = put[logKey(7)] as LogEntry;
    expect(attackEntry).toMatchObject({ kind: "attack", player: 0 });
    // The defender was substituted to representativeDefender's pick, NOT the agent's bogus proposal.
    expect((attackEntry as { decl: { defender: Hex } }).decl.defender).toEqual(expectedDefender);
    expect((attackEntry as { decl: { target: Hex } }).decl.target).toEqual(T);

    const endRoundEntry = put[logKey(8)] as LogEntry;
    expect(endRoundEntry).toMatchObject({ kind: "endRound", player: 0 });

    // Broadcasts: two `applied` (attack + endRound) then a single turnRollover; no gameOver.
    const appliedIdx = res.effects.broadcast.filter((m) => m.type === "applied").map((m) => (m as { logIndex: number }).logIndex);
    expect(appliedIdx).toEqual([7, 8]);
    const rollovers = res.effects.broadcast.filter((m) => m.type === "turnRollover");
    expect(rollovers).toHaveLength(1);
    expect(res.effects.broadcast.some((m) => m.type === "gameOver")).toBe(false);

    // The round closed → chainAttacker cleared (never left dangling; DER #5).
    expect(res.next.chainAttacker).toBeNull();
    expect(res.next.logLength).toBe(9);
  });

  test("rng threading: attack entry carries the agent-RETURNED rng; endRound carries the POST-ATTACK rng", () => {
    const pre = synthGame(attackBases(), { iron: IRON });
    const s = synthSession(pre, [{ kind: "agent", agent: "heuristic" }, { kind: "agent", agent: "heuristic" }]);

    // A drawing agent whose returned state carries an ADVANCED rng — discriminates the capture point from the
    // pre-selection game rng (mirrors the pass-rng test). Attack entry MUST carry THIS advanced rng.
    const preSelectionRng = pre.rngState;
    const postSelectionRng = nextInt(preSelectionRng, 1000).state;
    expect(postSelectionRng).not.toEqual(preSelectionRng);
    const drawingAttackAgent: Agent = (state, _p) => ({
      action: { kind: "attack", attacks: [{ target: T, attackers: ATTACKERS, defender: DEF_A }] },
      state: { ...state, rngState: postSelectionRng },
    });

    const res = driveOneStep(s, () => drawingAttackAgent, IDS);

    const put = res.effects.persist!.put;
    const attackEntry = put[logKey(7)] as LogEntry;
    const endRoundEntry = put[logKey(8)] as LogEntry;

    // Attack entry: the agent-returned (post-selection) rng — never the pre-selection game rng.
    expect(attackEntry.rngBeforeApply).toEqual(postSelectionRng);
    expect(attackEntry.rngBeforeApply).not.toEqual(preSelectionRng);

    // endRound entry: the POST-ATTACK state's rng (the attack installs postSelectionRng then applies, drawing combat).
    const finalDecl = { target: T, attackers: ATTACKERS, defender: representativeDefender(pre, T, 1)! };
    const throwaway = applyEntry(pre, { player: 0, kind: "attack", decl: finalDecl, rngBeforeApply: postSelectionRng });
    expect(endRoundEntry.rngBeforeApply).toEqual(throwaway.state.rngState);
    // Sanity: the combat drew, so the post-attack rng differs from the attack's installed rng.
    expect(throwaway.state.rngState).not.toEqual(postSelectionRng);
  });
});

test("driveOneStep — agent attacks a HUMAN defender: opens a pending, NO log entry, drive halts", () => {
  const pre = synthGame(attackBases(), { iron: IRON });
  // Seat 1 (the defender owner) is HUMAN → the drive must open a pending prompt, not apply the attack.
  const s = synthSession(pre, [{ kind: "agent", agent: "heuristic" }, { kind: "human" }]);

  const res = driveOneStep(s, () => attackAgentOnT(DEF_A), IDS);

  // No round applied: not advanced, not terminal.
  expect(res.advanced).toBe(false);
  expect(res.terminal).toBeNull();

  // The put carries ONLY the pending — no log:N entry, no snapshot.
  const put = res.effects.persist!.put;
  expect(Object.keys(put)).toContain(PENDING_KEY);
  expect(Object.keys(put).filter((k) => k.startsWith("log:"))).toEqual([]);
  expect(Object.keys(put)).not.toContain(SNAPSHOT_KEY);
  expect(res.next.logLength).toBe(7); // unchanged

  // The prompt is toSeat'd to the human defender seat (1); nothing broadcast.
  expect(res.effects.toSeat).toHaveLength(1);
  expect(res.effects.toSeat[0]!.seat).toBe(1);
  expect(res.effects.toSeat[0]!.message.type).toBe("prompt");
  expect(res.effects.broadcast).toEqual([]);

  // The pending is installed (with the host-supplied decisionId) and the drive HALTS — the invariant that
  // stops the loop so the human gets to choose.
  expect(res.next.pending).not.toBeNull();
  expect(res.next.pending!.decisionId).toBe(IDS.decisionId);
  expect(res.next.pending!.promptedSeat).toBe(1);
  expect(res.next.pending!.declaringPlayer).toBe(0);
  expect(needsDrive(res.next)).toBe(false);

  // Alarm pass-through at THIS entry point: DEFAULT_ROOM_OPTIONS has the defender timeout DISABLED → no alarm
  // (openDefenderDecision's effects flow through the DriveResult verbatim — pinned here, not just via applyCommand).
  expect(res.effects.alarm).toBeNull();
  expect(res.next.pending!.deadlineEpochMs).toBeNull();
});

test("driveOneStep — agent attacks a HUMAN defender with the timeout ENABLED: alarm set to now + seconds", () => {
  const pre = synthGame(attackBases(), { iron: IRON });
  const s0 = synthSession(pre, [{ kind: "agent", agent: "heuristic" }, { kind: "human" }]);
  const s: SessionState = { ...s0, roomOptions: { defenderTimeout: { enabled: true, seconds: 90 } } };

  const res = driveOneStep(s, () => attackAgentOnT(DEF_A), IDS);

  const expectedDeadline = IDS.nowEpochMs + 90 * 1000;
  expect(res.effects.alarm).toEqual({ action: "set", atEpochMs: expectedDeadline });
  expect(res.next.pending!.deadlineEpochMs).toBe(expectedDeadline);
});

test("driveOneStep — malformed agent attack (attacks.length !== 1) throws (mirrors recordGame)", () => {
  const pre = synthGame(attackBases(), { iron: IRON });
  const s = synthSession(pre, [{ kind: "agent", agent: "heuristic" }, { kind: "agent", agent: "heuristic" }]);

  // A multi-declaration attack violates the v1 single-decl trusted-agent contract → throw (a bug, not a wire error).
  const multiDeclAgent: Agent = (state, _p) => ({
    action: {
      kind: "attack",
      attacks: [
        { target: T, attackers: ATTACKERS, defender: DEF_A },
        { target: T, attackers: ATTACKERS, defender: DEF_A },
      ],
    },
    state,
  });
  expect(() => driveOneStep(s, () => multiDeclAgent, IDS)).toThrow(/single-declaration attacks/);

  // Zero-declaration attacks also violate the contract.
  const zeroDeclAgent: Agent = (state, _p) => ({ action: { kind: "attack", attacks: [] }, state });
  expect(() => driveOneStep(s, () => zeroDeclAgent, IDS)).toThrow(/single-declaration attacks/);
});

test("smoke: an all-agent game driven purely by driveOneStep reaches terminal — one gameOver, no turnRollover at the close", () => {
  // Real agents from agent-binding, all seats agent so the drive never halts on a human. This is the smoke for
  // the FULL branch driven end-to-end (the exhaustive recordGame parity is A4.5); its load-bearing assertion is
  // the gameOver mechanism through the driven loop. Note: default-config all-agent games terminate quickly by
  // noIron/last-standing elimination and rarely emit attacks — the agent-attack branch itself is covered by the
  // dedicated synthetic tests above; this test pins that the driven loop closes a terminal round correctly.
  const hdr: SessionHeader = {
    formatVersion: 1,
    replayVersion: "test",
    seed: 7n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [{ kind: "agent", agent: "heuristic" }, { kind: "agent", agent: "heuristic" }],
  };
  let s = openSession(hdr, DEFAULT_ROOM_OPTIONS);

  const TURN_CAP = 300;
  let terminal: ReturnType<typeof driveOneStep>["terminal"] = null;
  let closingStep: ReturnType<typeof driveOneStep> | null = null;
  let steps = 0;
  const MAX_STEPS = 100_000; // hard bound so a composition bug can't spin forever
  while (needsDrive(s) && steps < MAX_STEPS) {
    const step = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000 + steps, decisionId: `d-${steps}` });
    s = step.next;
    steps += 1;
    if (step.terminal !== null) { terminal = step.terminal; closingStep = step; break; }
    if (s.game.phase.turn > TURN_CAP) break; // cap — an all-agent game may not terminate within the budget
  }

  // Either the game terminated OR the turn cap was hit (both are acceptable smoke outcomes; assert one holds).
  const cappedOut = s.game.phase.turn > TURN_CAP;
  expect(terminal !== null || cappedOut).toBe(true);

  if (terminal !== null && closingStep !== null) {
    // The closing step communicates the win EXACTLY once and does NOT roll a next turn (victory skips advanceRound).
    const gameOvers = closingStep.effects.broadcast.filter((m) => m.type === "gameOver");
    expect(gameOvers).toHaveLength(1);
    expect(closingStep.effects.broadcast.some((m) => m.type === "turnRollover")).toBe(false);
    expect(needsDrive(s)).toBe(false); // terminal → no further drive
  }
});

// ===========================================================================
// Mid-setup victory: a placeFirstBase can decide the game before every seat
// has placed (a well-placed first base in a 3+ player game can already control
// ≥ victoryThreshold iron). applyEntry's placeFirstBase branch reports
// advanced:false, terminal:null UNCONDITIONALLY (placements never close a
// round), so the drive/command path would end the game with NO gameOver ever
// emitted — the plan's B3 obligation, resolved here IN commitEntries via a
// post-application status() check on placement batches. These tests pin the
// clinching-placement broadcast (exactly one gameOver, no turnRollover,
// advanced:false, no snapshot) on both the drive path and the command path.
// ===========================================================================

describe("mid-setup victory: commitEntries broadcasts gameOver at the clinching placement", () => {
  // 4p-mixed DEFAULT config, seed 1n: a greedy(aggressive)/greedy(expansionist)/greedy(economic)/heuristic roster
  // whose SECOND setup placement (seat 1) already controls ≥ victoryThreshold (10) iron — an iron victory decided
  // after 2 of 4 placements (probed across seeds; seed 1n is representative). The remaining seats can never place
  // interactively (their placeFirstBase would be GAME_OVER-rejected — session.ts). The all-agent DRIVE path reaches
  // this via driveOneStep; the command path reaches it when the clinching seat is a HUMAN placing via applyCommand.
  const agg = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "aggressive" });
  const exp = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "expansionist" });
  const eco = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "economic" });
  const heu = (): SeatConfig => ({ kind: "agent", agent: "heuristic" });
  const MIDSETUP_SEED = 1n;
  function midSetupHeader(seats: SeatConfig[]): SessionHeader {
    return {
      formatVersion: 1,
      replayVersion: "test",
      seed: MIDSETUP_SEED,
      config: defaultConfig(),
      boardSource: { kind: "generate", size: 96, ironCount: 14 },
      seats,
    };
  }

  test("drive path: the clinching setup placement's DriveResult carries terminal + exactly one gameOver, no turnRollover, no snapshot", () => {
    // All-agent 4p roster: the drive auto-places each seat via representativeFirstBase until the game is decided.
    let s = openSession(midSetupHeader([agg(), exp(), eco(), heu()]), DEFAULT_ROOM_OPTIONS);

    let clinching: ReturnType<typeof driveOneStep> | null = null;
    let placementsBefore = 0;
    let step = 0;
    while (needsDrive(s) && step < 100) {
      expect(s.game.phase.turn).toBe(0); // this scenario is decided ENTIRELY within setup — never leaves turn 0
      const r = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000 + step, decisionId: `d-${step}` });
      s = r.next;
      step += 1;
      if (r.terminal !== null) { clinching = r; break; }
      placementsBefore += 1;
    }

    // The game was decided mid-setup — BEFORE all four seats placed (the load-bearing precondition; if a future
    // board/agent change pushed the victory to the last placement or into play, this scenario would be vacuous).
    expect(clinching, "the drive must reach a mid-setup terminal").not.toBeNull();
    expect(placementsBefore, "victory was decided before all 4 seats placed").toBeLessThan(3);

    // The clinching step is a placeFirstBase that did NOT close a round (advanced:false) yet reported terminal.
    const put = clinching!.effects.persist!.put;
    const logKeys = Object.keys(put).filter((k) => k.startsWith("log:"));
    expect(logKeys, "the clinching put carries exactly the placement's log:N").toHaveLength(1);
    expect((put[logKeys[0]!] as LogEntry).kind).toBe("placeFirstBase");
    expect(clinching!.advanced, "a placement never closes a round").toBe(false);
    expect(Object.keys(put)).not.toContain(SNAPSHOT_KEY); // NO snapshot — snapshots are round-boundary artifacts

    // terminal is the victory status; the broadcast carries EXACTLY ONE gameOver and NO turnRollover.
    expect(clinching!.terminal, "the DriveResult captured the mid-setup terminal").not.toBeNull();
    expect(clinching!.terminal!.kind).toBe("victory");
    const gameOvers = clinching!.effects.broadcast.filter((m) => m.type === "gameOver");
    expect(gameOvers, "exactly one gameOver at the clinching placement").toHaveLength(1);
    expect(clinching!.effects.broadcast.some((m) => m.type === "turnRollover"), "no turnRollover at a mid-setup victory (placements never advanceRound)").toBe(false);

    // winners/cause match an INDEPENDENT status() call on the post-application state.
    const st = status(s.game) as Extract<ReturnType<typeof status>, { kind: "victory" }>;
    const gameOver = gameOvers[0] as Extract<ServerMessage, { type: "gameOver" }>;
    expect(gameOver.winners, "gameOver winners == status().players").toEqual(st.players);
    expect(gameOver.cause, "gameOver cause == status().reason").toBe(st.reason);
    expect((clinching!.terminal as Extract<ReturnType<typeof status>, { kind: "victory" }>).players).toEqual(st.players);

    // The whole game emitted EXACTLY ONE gameOver (no double-emission across the driven placements) and the drive halts.
    expect(needsDrive(s), "terminal → no further drive").toBe(false);
  });

  test("command path: a HUMAN seat's clinching placeFirstBase reply/broadcast carries the gameOver; a later mutating command → GAME_OVER", () => {
    // Same seed/board, but seat 1 (the clinching seat) is HUMAN placing via applyCommand. Seat 0 places first (via
    // the drive, mirroring the real host split), then the human's placement clinches the iron victory — the reply
    // path must surface the gameOver, and the game is then GAME_OVER-locked for every subsequent mutating command.
    let s = openSession(midSetupHeader([agg(), { kind: "human" }, eco(), heu()]), DEFAULT_ROOM_OPTIONS);

    // Seat 0 (agent) places via the drive — one placement, no victory yet, still setup.
    expect(currentActor(s)).toBe(0);
    const seat0 = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000, decisionId: "d-0" });
    expect(seat0.terminal, "seat 0's placement does not yet decide the game").toBeNull();
    s = seat0.next;
    expect(s.game.phase.turn).toBe(0); // still setup
    expect(status(s.game).kind).toBe("ongoing");

    // Seat 1 (human) places its first base via applyCommand — the SAME representative hex the drive would pick,
    // so it clinches the identical iron victory. (legalFirstBaseHexes[0] is not guaranteed the clincher; use the
    // deterministic representative placement the engine/drive uses.)
    expect(currentActor(s)).toBe(1);
    const clinchHex = representativeFirstBase(s.game, 1);
    const ctx1: CommandCtx = { actingSeat: 1, nowEpochMs: 1_000_000, decisionId: "d-1" };
    const clinch = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: s.logLength, hex: clinchHex }, ctx1);

    // The placement applied (persist present, one log:N, NO snapshot) and carries the gameOver in its broadcast.
    const put = clinch.effects.persist!.put;
    const logKeys = Object.keys(put).filter((k) => k.startsWith("log:"));
    expect(logKeys).toHaveLength(1);
    expect((put[logKeys[0]!] as LogEntry).kind).toBe("placeFirstBase");
    expect(Object.keys(put)).not.toContain(SNAPSHOT_KEY);
    const gameOvers = clinch.effects.broadcast.filter((m) => m.type === "gameOver");
    expect(gameOvers, "the human's clinching placement broadcasts exactly one gameOver").toHaveLength(1);
    expect(clinch.effects.broadcast.some((m) => m.type === "turnRollover")).toBe(false);
    const st = status(clinch.next.game) as Extract<ReturnType<typeof status>, { kind: "victory" }>;
    expect(st.kind).toBe("victory");
    const gameOver = gameOvers[0] as Extract<ServerMessage, { type: "gameOver" }>;
    expect(gameOver.winners).toEqual(st.players);
    expect(gameOver.cause).toBe(st.reason);
    s = clinch.next;

    // The game is now over: any subsequent mutating command (e.g. seat 2's placeFirstBase) → GAME_OVER, no state change.
    const ctx2: CommandCtx = { actingSeat: 2, nowEpochMs: 1_000_000, decisionId: "d-2" };
    const after = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: s.logLength, hex: legalFirstBaseHexes(s.game)[0]! }, ctx2);
    expect(after.next).toBe(s); // unchanged
    expect(after.effects.persist).toBeNull();
    expect(after.effects.reply).toHaveLength(1);
    const reply = after.effects.reply[0]!;
    expect(reply.type).toBe("error");
    if (reply.type !== "error") throw new Error("expected error");
    expect(reply.code).toBe("GAME_OVER");
  });

  test("non-victory placement: an ordinary setup placement reports NO terminal and NO gameOver (no status-based behavior change)", () => {
    // A 2-human game: neither of the two setup placements can clinch an iron victory (a single base never controls
    // ≥ threshold on its own here), so commitEntries' placement status-check must NOT fire — no terminal, no gameOver.
    const s0 = openSession(midSetupHeader([{ kind: "human" }, { kind: "human" }]), DEFAULT_ROOM_OPTIONS);
    const ctx0: CommandCtx = { actingSeat: currentActor(s0), nowEpochMs: 1_000_000, decisionId: "d-0" };
    const r0 = applyCommand(s0, { type: "placeFirstBase", expectedLogIndex: 0, hex: legalFirstBaseHexes(s0.game)[0]! }, ctx0);
    expect(status(r0.next.game).kind, "one placement of two does not decide a 2p game").toBe("ongoing");
    expect(r0.effects.broadcast.some((m) => m.type === "gameOver")).toBe(false);
    expect(r0.effects.broadcast.some((m) => m.type === "turnRollover")).toBe(false); // placement never closes a round
    expect(Object.keys(r0.effects.persist!.put)).not.toContain(SNAPSHOT_KEY);
  });
});
