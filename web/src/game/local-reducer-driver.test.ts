// ABOUTME: Proves the LocalReducerDriver drives the REAL session reducer in-browser — a 2-human hotseat
// ABOUTME: through setup/build/attack-with-human-defender/resolve, and a human-vs-greedy game whose agent seat auto-plays.
//
// WHY THIS IS NON-TAUTOLOGICAL. The driver's ONLY job is to translate the reducer's `Effects` into `DriverEvent`s
// and run the host's apply-then-drive loop. So the test drives the reducer DIRECTLY (openSession/applyCommand/
// driveOneStep — the same functions the host uses, exercised standalone in test/session/part-a-integration.test.ts)
// to compute the ground truth, then asserts the driver's emitted event stream carries that truth: every `applied`
// entry decodes to the reducer's own composed LogEntry, logLength advances one-per-entry, the human defender is
// prompted, the resolveDecision closes the pending, and the greedy seat's moves surface as `applied` events with
// NO human submit. The reducer is trusted (proven correct in test/session/**); the driver is the unit under test.
import { describe, expect, test } from "vitest";
import { openSession, applyCommand } from "../../../src/session/session";
import { needsDrive, driveOneStep, currentActor } from "../../../src/session/agent-drive";
import { agentForSeat } from "../../../src/session/agent-binding";
import { legalActions, legalFirstBaseHexes, status, control, defaultConfig } from "../engine-client/barrel";
import { distance, key } from "../../../src/geometry/cube";
import { makeLocalReducerDriver } from "./local-reducer-driver";
import type { GameState, Hex, PlayerId, AttackDecl, SeatConfig, SessionHeader, LogEntry } from "../engine-client/barrel";
import type { DriverEvent } from "./driver";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────
const HUMAN: SeatConfig = { kind: "human" };
const GREEDY: SeatConfig = { kind: "agent", agent: "greedy", archetype: "economic" };

/** The seed-2 / greedy-seat-2 / victoryThreshold-20 roster from test/session/part-a-integration.test.ts — proven to
 *  reach a legal human(seat0)-attacks-human(seat1) action at the 6th play step, so a human defender IS prompted. */
function hvhHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 2n,
    config: { ...defaultConfig(), victoryThreshold: 20, allowPass: true },
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [HUMAN, HUMAN, GREEDY],
  };
}

/** A 2-human hotseat header on the deterministic seed-1 board (both seats controllable, no agent). */
function twoHumanHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 1n,
    config: defaultConfig(),
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [HUMAN, HUMAN],
  };
}

/** A human-vs-greedy header: seat 0 human, seat 1 greedy. On seed 1 the greedy seat auto-plays its setup + rounds. */
function humanVsGreedyHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 1n,
    config: { ...defaultConfig(), victoryThreshold: 20, allowPass: true },
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [HUMAN, GREEDY],
  };
}

/** An AGENT-FIRST header: seat 0 greedy (places first in setup), seat 1 human. The greedy seat must auto-place
 *  on OPEN (before any human command) or the human seat can never take its setup turn — the host drives agents on
 *  init (src/host/game-room.ts POST /init → openSession → driveAgents). */
function agentFirstHeader(): SessionHeader {
  return {
    formatVersion: 1,
    replayVersion: "test",
    seed: 1n,
    config: { ...defaultConfig(), victoryThreshold: 20, allowPass: true },
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    seats: [GREEDY, HUMAN],
  };
}

/** Deterministic id source so decisionIds are stable across a test run. */
function fixedIds(): () => string {
  let n = 0;
  return () => `d-${n++}`;
}

/** Collect every DriverEvent a driver emits into an array, in order. Returns the array + an unsubscribe fn. */
function collect(driver: { subscribe(h: (e: DriverEvent) => void): () => void }): { events: DriverEvent[]; unsub: () => void } {
  const events: DriverEvent[] = [];
  const unsub = driver.subscribe((e) => events.push(e));
  return { events, unsub };
}

// ── GROUND-TRUTH helpers driving the RAW reducer (the same host functions, standalone) ───────────────────────
/** Whoever's placement/turn it currently is. */
function actor(s: ReturnType<typeof openSession>): PlayerId {
  return s.game.phase.order[s.game.phase.indexInOrder]!;
}

describe("makeLocalReducerDriver — 2-human hotseat", () => {
  test("subscribe emits an initial sync from the opened SessionState (decoded snapshot, logLength 0, both seats, no pending)", () => {
    const header = twoHumanHeader();
    const driver = makeLocalReducerDriver(header, { nextDecisionId: fixedIds() });
    const { events } = collect(driver);

    expect(events).toHaveLength(1);
    const sync = events[0]!;
    expect(sync.type).toBe("sync");
    if (sync.type !== "sync") throw new Error("expected sync");
    // The snapshot is the live decoded GameState the store folds onto (setup phase, turn 0).
    expect(sync.snapshot.phase.turn).toBe(0);
    expect(sync.logLength).toBe(0);
    expect(sync.pending).toBeNull();
    expect(sync.seats).toEqual([
      { seat: 0, claimed: false, kind: "human" },
      { seat: 1, claimed: false, kind: "human" },
    ]);
    driver.dispose();
  });

  test("controllableSeats() returns all human seats (hotseat shares the screen)", () => {
    const driver = makeLocalReducerDriver(twoHumanHeader(), { nextDecisionId: fixedIds() });
    expect(driver.controllableSeats()).toEqual([0, 1]);
    driver.dispose();
  });

  test("setup placeFirstBase submits emit an `applied` per placement whose decoded entry matches the reducer's own", async () => {
    const header = twoHumanHeader();
    // GROUND TRUTH: drive the raw reducer through the two setup placements and capture its composed entries.
    let s = openSession(header, { defenderTimeout: { enabled: false, seconds: 120 } });
    const expectedEntries: LogEntry[] = [];
    const placements: Hex[] = [];
    for (let idx = 0; idx < 2; idx++) {
      const p = actor(s);
      const hex = legalFirstBaseHexes(s.game)[0]!;
      placements.push(hex);
      const r = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: idx, hex }, { actingSeat: p, nowEpochMs: 0, decisionId: "x" });
      const put = r.effects.persist!.put;
      for (const k of Object.keys(put).filter((x) => x.startsWith("log:")).sort()) expectedEntries.push(put[k] as LogEntry);
      s = r.next;
    }
    expect(s.game.phase.turn).toBeGreaterThan(0); // setup complete after both placements

    // DRIVER: submit the SAME placements; assert the emitted `applied` stream matches the reducer's entries.
    const driver = makeLocalReducerDriver(header, { nextDecisionId: fixedIds() });
    const { events } = collect(driver);
    await driver.submit({ type: "placeFirstBase", hex: placements[0]! });
    await driver.submit({ type: "placeFirstBase", hex: placements[1]! });

    const applied = events.filter((e) => e.type === "applied");
    expect(applied).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const e = applied[i]!;
      if (e.type !== "applied") throw new Error("expected applied");
      expect(e.logIndex).toBe(i); // continuous, store-foldable
      expect(e.entry).toEqual(expectedEntries[i]); // DECODED entry == the reducer's own composed LogEntry
      expect(e.entry.kind).toBe("placeFirstBase");
      // The entry is DECODED (LogEntry, not the wire EncodedLogEntry): rngBeforeApply carries BIGINTS, not the
      // encoded decimal STRINGS — proving the driver ran decodeEntry (an un-decoded entry would break the store's
      // applyEntry fold, which expects a RngState). This is the specific "forgot to decode" tripwire.
      expect(typeof e.entry.rngBeforeApply.state).toBe("bigint");
      expect(typeof e.entry.rngBeforeApply.inc).toBe("bigint");
    }
    driver.dispose();
  });
});

describe("makeLocalReducerDriver — human-vs-human attack with a human defender", () => {
  test("attack prompts the human defender; resolveDecision closes the pending and emits the attack `applied`", async () => {
    const header = hvhHeader();
    // ── Reproduce the proven scripted seed-2 game via the RAW reducer to find the human-vs-human attack decl. ──
    let s = openSession(header, { defenderTimeout: { enabled: false, seconds: 120 } });
    const mkCtx = (seat: number, id = "x") => ({ actingSeat: seat, nowEpochMs: 0, decisionId: id });
    // Setup: humans place (seat 1 steered nearest seat 0), agent drives.
    let idx = 0;
    const scriptedPlacements: { seat: PlayerId; hex: Hex }[] = [];
    while (s.game.phase.turn === 0) {
      const p = actor(s);
      if (s.header.seats[p]!.kind === "agent") {
        s = driveOneStep(s, agentForSeat, { nowEpochMs: 0, decisionId: "setup" }).next;
      } else {
        const legal = legalFirstBaseHexes(s.game);
        let hex = legal[0]!;
        if (p === 1) {
          const seat0 = s.game.bases.filter((b) => b.owner === 0).map((b) => b.hex);
          if (seat0.length > 0) {
            hex = legal.slice().sort((a, b) =>
              Math.min(...seat0.map((o) => distance(a, o))) - Math.min(...seat0.map((o) => distance(b, o))))[0]!;
          }
        }
        scriptedPlacements.push({ seat: p, hex });
        s = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: idx, hex }, mkCtx(p)).next;
      }
      idx += 1;
    }
    // The driver runs setup itself (humans submit, agent drives) — but to reach the attack quickly and
    // deterministically in the DRIVER, we replay the full scripted human command sequence through it below.
    // Here we just derive the human build/attack script from the raw run.
    const humanScript: { seat: PlayerId; cmd: { type: "build"; pieces: { type: "factory" | "base"; hex: Hex }[] } | { type: "pass" } | { type: "attack"; decl: AttackDecl } }[] = [];
    let hvhDecl: AttackDecl | null = null;
    let attackerSeat: PlayerId = -1 as PlayerId;
    for (let played = 0; played < 200 && hvhDecl === null; played++) {
      if (status(s.game).kind !== "ongoing") break;
      const p = actor(s);
      if (needsDrive(s)) { s = driveOneStep(s, agentForSeat, { nowEpochMs: 0, decisionId: `drive-${played}` }).next; continue; }
      // human-vs-human attack available?
      let found: AttackDecl | null = null;
      if (p <= 1) {
        for (const a of legalActions(s.game)) {
          if (a.kind !== "attack") continue;
          const decl = a.attacks[0]!;
          const tb = s.game.bases.find((b) => key(b.hex) === key(decl.target));
          if (tb && tb.owner <= 1 && tb.owner !== p) { found = decl; break; }
        }
      }
      if (found !== null) { hvhDecl = found; attackerSeat = p; humanScript.push({ seat: p, cmd: { type: "attack", decl: found } }); break; }
      // else build toward opponent (iron-preserving), matching part-a-integration.
      const opp: PlayerId = p === 0 ? 1 : 0;
      const oppBases = s.game.bases.filter((b) => b.owner === opp).map((b) => b.hex);
      const ironBefore = control(s.game, p).iron.length;
      let best: { type: "base"; hex: Hex }[] | null = null;
      let bestDist = Infinity;
      for (const a of legalActions(s.game)) {
        if (a.kind !== "build" || a.pieces.length !== 1 || a.pieces[0]!.type !== "base") continue;
        const hex = a.pieces[0]!.hex;
        const trial = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: [{ type: "base", hex }] }, mkCtx(p));
        if (trial.effects.persist === null) continue;
        if (control(trial.next.game, p).iron.length < ironBefore) continue;
        const d = oppBases.length > 0 ? Math.min(...oppBases.map((o) => distance(hex, o))) : 0;
        if (d < bestDist) { bestDist = d; best = [{ type: "base", hex }]; }
      }
      if (best !== null) {
        humanScript.push({ seat: p, cmd: { type: "build", pieces: best } });
        s = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: best }, mkCtx(p)).next;
      } else {
        humanScript.push({ seat: p, cmd: { type: "pass" } });
        s = applyCommand(s, { type: "pass", expectedLogIndex: s.logLength }, mkCtx(p)).next;
      }
    }
    if (hvhDecl === null) throw new Error("BUG/regression: the scripted seed-2 sequence no longer reaches a human-vs-human attack");
    const defenderOwner = s.game.bases.find((b) => key(b.hex) === key(hvhDecl!.target))!.owner;
    expect(defenderOwner).toBeLessThanOrEqual(1);
    expect(defenderOwner).not.toBe(attackerSeat);

    // ── Now REPLAY the same human script through the DRIVER (agent seats auto-drive between human submits). ──
    const driver = makeLocalReducerDriver(header, { nextDecisionId: fixedIds() });
    const { events } = collect(driver);
    // Setup placements through the driver.
    for (const pl of scriptedPlacements) await driver.submit({ type: "placeFirstBase", hex: pl.hex });
    // Human build/pass/attack script (the driver auto-drives the greedy seat between these).
    for (const step of humanScript) {
      if (step.cmd.type === "build") await driver.submit({ type: "build", pieces: step.cmd.pieces });
      else if (step.cmd.type === "pass") await driver.submit({ type: "pass" });
      else await driver.submit({ type: "attack", decl: step.cmd.decl });
    }

    // A prompt MUST have fired for the human defender (attack against a human opens a pending, appends NO entry).
    const prompts = events.filter((e) => e.type === "prompt");
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0]!;
    if (prompt.type !== "prompt") throw new Error("expected prompt");
    expect(prompt.pending.promptedSeat).toBe(defenderOwner);
    expect(prompt.pending.target).toEqual(hvhDecl.target);
    expect(prompt.pending.eligibleDefenders.length).toBeGreaterThan(0);

    // The attack appended NO `applied` yet (the attack entry lands on resolution).
    const logIndexAtPrompt = events.filter((e) => e.type === "applied").length;

    // ── Resolve as the prompted defender: the attack entry (+ its auto-close endRound) now applies. ──
    const eventsBeforeResolve = events.length;
    await driver.submit({ type: "resolveDecision", decisionId: prompt.pending.decisionId, defender: hvhDecl.defender });

    const afterResolve = events.slice(eventsBeforeResolve);
    const newApplied = afterResolve.filter((e) => e.type === "applied");
    // The attack entry is the first newly-applied; assert it decodes to an attack against the target.
    expect(newApplied.length).toBeGreaterThanOrEqual(1);
    const attackApplied = newApplied[0]!;
    if (attackApplied.type !== "applied") throw new Error("expected applied");
    expect(attackApplied.entry.kind).toBe("attack");
    if (attackApplied.entry.kind === "attack") {
      expect(attackApplied.entry.decl.target).toEqual(hvhDecl.target);
      expect(attackApplied.entry.decl.defender).toEqual(hvhDecl.defender);
    }
    expect(attackApplied.logIndex).toBe(logIndexAtPrompt); // continuous from where the prompt paused the log
    driver.dispose();
  });
});

describe("makeLocalReducerDriver — human vs greedy (agent-drive emits agent moves without a human submit)", () => {
  test("after the human's setup placement, the greedy seat's setup + play moves surface as `applied` events with no human submit for them", async () => {
    const header = humanVsGreedyHeader();
    const driver = makeLocalReducerDriver(header, { nextDecisionId: fixedIds() });
    const { events } = collect(driver);

    // The human (seat 0) places its first base. The driver then auto-drives the greedy seat's setup placement
    // AND any subsequent greedy rounds up to the human's next turn — all WITHOUT another human submit.
    const sync = events[0]!;
    if (sync.type !== "sync") throw new Error("expected sync");
    // seat 0 is the human; find its legal first-base hex from the synced snapshot.
    const humanHex = legalFirstBaseHexes(sync.snapshot as GameState)[0]!;
    await driver.submit({ type: "placeFirstBase", hex: humanHex });

    // At least TWO applied entries: the human's placeFirstBase AND the greedy seat's placeFirstBase (auto-driven).
    const applied = events.filter((e) => e.type === "applied");
    expect(applied.length).toBeGreaterThanOrEqual(2);
    // The FIRST applied is the human's placement; a LATER applied is authored by the agent seat (player 1),
    // proving the drive loop ran the agent with NO human submit for it.
    const kinds = applied.map((e) => (e.type === "applied" ? e.entry.kind : ""));
    expect(kinds[0]).toBe("placeFirstBase");
    const agentAuthored = applied.some((e) => e.type === "applied" && e.entry.player === 1);
    expect(agentAuthored).toBe(true);
    // logIndex continuity across the whole emitted stream (store-foldable).
    applied.forEach((e, i) => {
      if (e.type === "applied") expect(e.logIndex).toBe(i);
    });
    driver.dispose();
  });
});

describe("makeLocalReducerDriver — agent-first opening (drives agents on open, mirroring the host's init)", () => {
  test("the greedy seat 0 auto-places on open, so the initial sync already shows its placement and the human seat 1 can act", async () => {
    const driver = makeLocalReducerDriver(agentFirstHeader(), { nextDecisionId: fixedIds() });
    const { events } = collect(driver);

    // The initial sync must already reflect the agent-first placement (seat 0 auto-placed on open). If the driver
    // did NOT drive on open, the snapshot would show zero bases (turn 0, indexInOrder 0 = the un-placed agent) and
    // the human's placement below would be NOT_YOUR_TURN → a dead game.
    const sync = events[0]!;
    if (sync.type !== "sync") throw new Error("expected sync");
    const agentBases = (sync.snapshot as GameState).bases.filter((b) => b.owner === 0);
    expect(agentBases.length).toBe(1); // the greedy seat placed its first base on open
    expect(sync.logLength).toBe(1);

    // Now the HUMAN (seat 1) can take its setup turn — its placeFirstBase applies (not NOT_YOUR_TURN).
    const humanHex = legalFirstBaseHexes(sync.snapshot as GameState)[0]!;
    const before = events.length;
    await driver.submit({ type: "placeFirstBase", hex: humanHex });
    const applied = events.slice(before).filter((e) => e.type === "applied");
    const rejected = events.slice(before).filter((e) => e.type === "rejected");
    expect(rejected).toHaveLength(0); // the human's setup turn was NOT rejected
    expect(applied.some((e) => e.type === "applied" && e.entry.player === 1)).toBe(true); // the human placed
    driver.dispose();
  });
});

describe("makeLocalReducerDriver — requestSync / dispose", () => {
  test("requestSync re-emits a sync reflecting the current SessionState", async () => {
    const header = twoHumanHeader();
    const driver = makeLocalReducerDriver(header, { nextDecisionId: fixedIds() });
    const { events } = collect(driver);
    const hex = legalFirstBaseHexes((events[0]! as Extract<DriverEvent, { type: "sync" }>).snapshot as GameState)[0]!;
    await driver.submit({ type: "placeFirstBase", hex });

    const before = events.length;
    driver.requestSync();
    const after = events.slice(before);
    expect(after).toHaveLength(1);
    const sync = after[0]!;
    expect(sync.type).toBe("sync");
    if (sync.type !== "sync") throw new Error("expected sync");
    expect(sync.logLength).toBe(1); // the placement advanced the log
    driver.dispose();
  });

  test("dispose stops delivering events to subscribers", async () => {
    const header = twoHumanHeader();
    const driver = makeLocalReducerDriver(header, { nextDecisionId: fixedIds() });
    const { events } = collect(driver);
    driver.dispose();
    const before = events.length;
    driver.requestSync(); // after dispose, nothing should be delivered
    expect(events.length).toBe(before);
  });
});
