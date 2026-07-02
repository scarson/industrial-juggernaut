// ABOUTME: Agent-drive loop tests with a FAKE agent (isolates loop mechanics from real agent policy).
// ABOUTME: Pins the agent-drive invariant (spec §3): drive agent/eliminated rounds forward, logging each atomically.
import { test, expect, describe } from "vitest";
import { currentActor, needsDrive, driveOneStep, commitEntries } from "../../src/session/agent-drive";
import { openSession } from "../../src/session/session";
import { agentForSeat } from "../../src/session/agent-binding";
import { logKey, PENDING_KEY, SNAPSHOT_KEY } from "../../src/session/keys";
import { stateHash } from "../../src/session/hash";
import { representativeFirstBase } from "../../src/engine/turn";
import { representativeDefender } from "../../src/engine/legal";
import { applyEntry } from "../../src/session/round";
import { defaultConfig } from "../../src/engine/config";
import { nextInt, seed } from "../../src/rng/pcg";
import { key } from "../../src/geometry/cube";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { Agent } from "../../src/agent/agent";
import type { Base, GameState, Hex, PlayerId, RngState } from "../../src/engine/types";
import type { SessionHeader, LogEntry, SeatConfig } from "../../src/session/types";
import type { SessionState } from "../../src/session/session-types";

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

test("play drive: a fake pass-agent round closes the round — one pass entry + snapshot + turnRollover(ironWeights:null)", () => {
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
