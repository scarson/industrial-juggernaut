// ABOUTME: A6.5 Part-A acceptance — a mixed human+agent game driven purely through the reducer functions on a REAL
// ABOUTME: generated board, whose accumulated RAW log replays (replayLog) to the byte-identical final reducer state.
//
// WHY THIS TEST IS LEGITIMATE (not tautological). The interactive command path (applyCommand / driveOneStep /
// resolveDecision) and replayLog are INDEPENDENT implementations: replayLog reconstructs state from header + log via
// applyEntry alone, with none of the round-state-machine / write-lock / pending / seat-auth logic the command path
// carries. The two share ONLY applyEntry — the per-entry engine step — and that seam is itself already proven correct
// against a third independent path (recordGame) in test/session/drive-vs-recordgame.test.ts (the A4.5 cross-check).
// So this test closes the loop: if the reducer's command path ever composed the wrong LogEntry, or persisted entries
// in the wrong order, replayLog over those same raw entries would diverge from the reducer's own final state.
//
// It is deliberately end-to-end-ish: setup placements (human seats via applyCommand placeFirstBase, agent seats via
// driveOneStep — the REAL host split, matching apply-command-envelope.test.ts's completeSetup), a run of play rounds
// (human builds via applyCommand, agent rounds via driveOneStep), a human-attacks-HUMAN attack that opens a durable
// pending and is resolved by the prompted defender via resolveDecision (the full pending flow through applyCommand —
// the acceptance requirement), then the raw-log replay equivalence.
//
// THE RAW LOG, NOT THE BROADCASTS. We accumulate the RAW LogEntry[] from each successful command/drive result's
// effects.persist.put `log:N` values (bigints intact, numeric key order), NOT the encoded `applied` broadcasts:
// re-decoding those EncodedLogEntry values would just re-test the wire codec (test/wire/codec.test.ts), not the
// reducer's log composition. This mirrors the accumulation pattern in drive-vs-recordgame.test.ts.
//
// FINDING THE HUMAN-vs-HUMAN ATTACK ON A REAL BOARD (the hard part). A real generated 96-hex board seats every
// first base on the far outer ring, while all iron clusters near the centre; radiating players share that central
// iron. Two traps had to be threaded (both confirmed by a fixed-seed probe sweep over seeds 1,2,3,5,7,11,17,23,42
// and the four agent kinds):
//   (1) The HEURISTIC agent (and to a lesser degree any agent that sprawls) builds several bases in a single greedy
//       round, instantly reaching a 4+ base perimeter whose convex hull encloses the shared central iron; DER-17
//       exclusivity then strips that iron from the still-radiating human seats and applyEliminations kills them
//       (noIron) — a last-standing agent victory within 1-6 play steps, before any human can mount an attack.
//       A GREEDY agent builds one piece per round, so it does NOT enclose all iron immediately; that is the agent
//       kind used here. (This is the same central-iron / DER-17 mechanism documented in testing-pitfalls §8, here
//       arising on a REAL board rather than a synthetic one — so the fix is agent/seed selection, not synthetic iron.)
//   (2) The two human seats start on the outer ring, typically far apart. We (a) place seat 1's first base on the
//       legal outer-ring hex NEAREST seat 0's base (so the two clusters begin adjacent, distance ~1, already inside
//       attackRange 6), and (b) have each human build ONLY bases that do not drop its own controlled-iron count
//       (probed by simulating the build) and that step toward the opponent — keeping both alive while their fresh
//       base counts climb to the >=3 that legalActions needs to emit an attack.
// The probe found seed 2n with a GREEDY/economic agent reaches a legal human(seat 0)-attacks-human(seat 1) action at
// the 6th play step; we replay that exact scripted sequence here (no probing at test time — the script is fixed).
import { test, expect } from "vitest";
import { openSession, applyCommand } from "../../src/session/session";
import { needsDrive, driveOneStep } from "../../src/session/agent-drive";
import { agentForSeat } from "../../src/session/agent-binding";
import { replayLog } from "../../src/session/replay";
import { stateHash } from "../../src/session/hash";
import { legalActions, legalFirstBaseHexes, status, control } from "../../src/index";
import { distance, key } from "../../src/geometry/cube";
import { defaultConfig } from "../../src/engine/config";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import { logKey, SNAPSHOT_KEY, PENDING_KEY } from "../../src/session/keys";
import type { SessionHeader, SeatConfig, LogEntry } from "../../src/session/types";
import type { SessionState, CommandCtx } from "../../src/session/session-types";
import type { Hex, PlayerId, AttackDecl } from "../../src/engine/types";

// A 3-seat mixed roster: two humans (seats 0,1) + one GREEDY agent (seat 2 — greedy so it does not sprawl into an
// all-iron perimeter and eliminate the humans before they can attack; see the header comment). victoryThreshold 20
// (per the A4.5 vacuity discovery — the default of 10 ends mixed games in 1-2 rounds with zero combat, so the
// attack path would be unreachable) and allowPass so a stuck human can always progress the round legally.
const HUMAN: SeatConfig = { kind: "human" };
const AGENT: SeatConfig = { kind: "agent", agent: "greedy", archetype: "economic" };
const HEADER: SessionHeader = {
  formatVersion: 1,
  replayVersion: "test",
  seed: 2n,
  config: { ...defaultConfig(), victoryThreshold: 20, allowPass: true },
  boardSource: { kind: "generate", size: 96, ironCount: 14 },
  seats: [HUMAN, HUMAN, AGENT],
};

const mkCtx = (actingSeat: number, decisionId = "decision-xyz"): CommandCtx => ({ actingSeat, nowEpochMs: 1_000_000, decisionId });

/** Whoever's placement/turn it currently is (setup: the placer; play: the current player — same index either way). */
function actor(s: SessionState): PlayerId {
  return s.game.phase.order[s.game.phase.indexInOrder]!;
}

/** Absorb the RAW `log:N` entries from a persist.put into `rawLog`, in numeric (== zero-padded lexical) key order.
 *  A pending-open put carries only PENDING_KEY (no log:N), so this is a no-op for it — exactly the reducer's
 *  contract that opening a defender decision appends NOTHING to the log until it resolves. */
function absorb(rawLog: LogEntry[], put: Record<string, unknown> | null | undefined): void {
  if (!put) return;
  for (const k of Object.keys(put).filter((x) => x.startsWith("log:")).sort()) rawLog.push(put[k] as LogEntry);
}

/** Drive setup to completion. Human seats place their first base via applyCommand (the real wire path); the agent
 *  seat places via driveOneStep (the real host agent-drive path — the DO host never routes agent play through
 *  applyCommand). Seat 1 is steered onto the legal outer-ring hex nearest seat 0's base so the two human clusters
 *  begin adjacent (already within attackRange). Returns the PLAY-phase state; appends every placement to rawLog. */
function completeSetup(s: SessionState, rawLog: LogEntry[]): SessionState {
  let idx = 0;
  while (s.game.phase.turn === 0) {
    const p = actor(s);
    if (s.header.seats[p]!.kind === "agent") {
      const r = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000, decisionId: "setup-drive" });
      if (r.effects.persist === null) throw new Error(`agent setup drive produced no persist at idx ${idx}`);
      absorb(rawLog, r.effects.persist.put);
      s = r.next;
    } else {
      const legal = legalFirstBaseHexes(s.game);
      let hex = legal[0]!;
      if (p === 1) {
        const seat0 = s.game.bases.filter((b) => b.owner === 0).map((b) => b.hex);
        if (seat0.length > 0) {
          hex = legal
            .slice()
            .sort((a, b) => Math.min(...seat0.map((o) => distance(a, o))) - Math.min(...seat0.map((o) => distance(b, o))))[0]!;
        }
      }
      const r = applyCommand(s, { type: "placeFirstBase", expectedLogIndex: idx, hex }, mkCtx(p));
      if (r.effects.persist === null) throw new Error(`setup placement rejected at idx ${idx}`);
      absorb(rawLog, r.effects.persist.put);
      s = r.next;
    }
    idx += 1;
  }
  return s;
}

/** Pick a single-base build for the human `p` that (a) does NOT reduce p's controlled-iron count (probed by
 *  applying the candidate to a throwaway and reading control().iron) — this keeps p alive against noIron / DER-17 —
 *  and (b) is the surviving candidate nearest the opponent human's cluster (steering the two clusters together).
 *  Returns null when no iron-preserving base build exists (caller falls back to pass). */
function humanBuildTowardOpponent(s: SessionState, p: PlayerId): { type: "factory" | "base"; hex: Hex }[] | null {
  const opp: PlayerId = p === 0 ? 1 : 0;
  const oppBases = s.game.bases.filter((b) => b.owner === opp).map((b) => b.hex);
  const ironBefore = control(s.game, p).iron.length;
  const baseBuilds = legalActions(s.game).filter(
    (a): a is Extract<typeof a, { kind: "build" }> => a.kind === "build" && a.pieces.length === 1 && a.pieces[0]!.type === "base",
  );
  let best: { type: "factory" | "base"; hex: Hex }[] | null = null;
  let bestDist = Infinity;
  for (const b of baseBuilds) {
    const hex = b.pieces[0]!.hex;
    const trial = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: [{ type: "base", hex }] }, mkCtx(p));
    if (trial.effects.persist === null) continue; // engine-rejected placement — skip
    if (control(trial.next.game, p).iron.length < ironBefore) continue; // would strand p off its iron — skip
    const d = oppBases.length > 0 ? Math.min(...oppBases.map((o) => distance(hex, o))) : 0;
    if (d < bestDist) {
      bestDist = d;
      best = [{ type: "base", hex }];
    }
  }
  return best;
}

/** Is a legal human-attacks-the-OTHER-human action available to the current human actor `p`? Returns the reducer's
 *  own representative AttackDecl (target + nearest attackers + representative defender) so we feed applyCommand a
 *  decl that legalActions already guaranteed legal — never a hand-built one. */
function humanVsHumanAttack(s: SessionState, p: PlayerId): AttackDecl | null {
  if (p > 1) return null; // only human seats 0,1
  for (const a of legalActions(s.game)) {
    if (a.kind !== "attack") continue;
    const decl = a.attacks[0]!;
    const targetBase = s.game.bases.find((b) => key(b.hex) === key(decl.target));
    if (targetBase === undefined) continue;
    if (targetBase.owner <= 1 && targetBase.owner !== p) return decl; // target owned by the OTHER human
  }
  return null;
}

test("Part-A acceptance: a mixed human+agent game's reducer log replays to the identical final state (incl. a human-vs-human pending resolved via resolveDecision)", () => {
  const rawLog: LogEntry[] = [];
  let s = openSession(HEADER, DEFAULT_ROOM_OPTIONS);

  // ── Setup: human placements (applyCommand) + agent placement (driveOneStep). ──────────────────────────────
  s = completeSetup(s, rawLog);
  expect(s.game.phase.turn).toBeGreaterThan(0); // setup complete → play phase
  expect(rawLog.length).toBe(s.logLength); // every placement absorbed, nothing missed
  expect(status(s.game).kind).toBe("ongoing"); // the game is live entering play

  // ── Play rounds: humans build toward each other (applyCommand), agent rounds drive (driveOneStep), until a
  //    legal human-attacks-human action appears for the current human actor. The loop is deterministic (fixed
  //    seed, fixed build/placement selection) — the bound is a guard against a composition regression, not a probe. ─
  let hvhDecl: AttackDecl | null = null;
  let attackerSeat = -1;
  const MAX_PLAY_STEPS = 200;
  let played = 0;
  for (; played < MAX_PLAY_STEPS; played += 1) {
    expect(status(s.game).kind, "the game must not terminate before the human-vs-human attack (agent/seed selection)").toBe("ongoing");
    const p = actor(s);
    if (needsDrive(s)) {
      const r = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000 + played, decisionId: `drive-${played}` });
      absorb(rawLog, r.effects.persist?.put ?? null);
      s = r.next;
      // A greedy agent attacking a human WOULD open a pending; the scripted seed never reaches that before our own
      // human-vs-human attack. Assert it, so a future agent/seed change that changes this surfaces loudly here.
      expect(s.pending, "the agent must not open a pending before our scripted human-vs-human attack").toBeNull();
      continue;
    }
    const decl = humanVsHumanAttack(s, p);
    if (decl !== null) {
      hvhDecl = decl;
      attackerSeat = p;
      break;
    }
    const build = humanBuildTowardOpponent(s, p);
    if (build !== null) {
      const r = applyCommand(s, { type: "build", expectedLogIndex: s.logLength, pieces: build }, mkCtx(p));
      expect(r.effects.persist, "the scripted human build must apply").not.toBeNull();
      absorb(rawLog, r.effects.persist!.put);
      s = r.next;
    } else {
      const r = applyCommand(s, { type: "pass", expectedLogIndex: s.logLength }, mkCtx(p));
      expect(r.effects.persist, "a stuck human must at least pass legally").not.toBeNull();
      absorb(rawLog, r.effects.persist!.put);
      s = r.next;
    }
  }
  // Precondition for the acceptance: the scripted sequence DID reach a human-vs-human attack (non-vacuity).
  if (hvhDecl === null) throw new Error("BUG/regression: the scripted seed-2 sequence no longer reaches a human-vs-human attack");
  const defenderOwner = s.game.bases.find((b) => key(b.hex) === key(hvhDecl!.target))!.owner;
  expect(attackerSeat).toBeLessThanOrEqual(1); // a human attacked
  expect(defenderOwner).toBeLessThanOrEqual(1); // …another human
  expect(defenderOwner).not.toBe(attackerSeat);
  expect(s.header.seats[defenderOwner]!.kind).toBe("human");

  // ── The human attack: opens a durable pending (write-lock), appends NO log entry, prompts ONLY the defender. ──
  const logLenBeforeAttack = s.logLength;
  const rawLenBeforeAttack = rawLog.length;
  const attack = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl: hvhDecl }, mkCtx(attackerSeat, "hvh-decision"));
  // The pending-open put carries ONLY the pending key (no log:N, no snapshot) — the attack applies on resolution.
  expect(Object.keys(attack.effects.persist!.put)).toEqual([PENDING_KEY]);
  expect(attack.next.pending).not.toBeNull();
  expect(attack.next.pending!.promptedSeat).toBe(defenderOwner);
  expect(attack.next.logLength).toBe(logLenBeforeAttack); // no entry appended while the decision is pending
  // The prompt is PRIVATE to the defender seat: exactly one toSeat message, addressed to the defender, no broadcast.
  expect(attack.effects.toSeat).toHaveLength(1);
  expect(attack.effects.toSeat[0]!.seat).toBe(defenderOwner);
  expect(attack.effects.toSeat[0]!.message.type).toBe("prompt");
  expect(attack.effects.broadcast).toEqual([]);
  absorb(rawLog, attack.effects.persist?.put ?? null); // no-op: pending-only put has no log:N
  expect(rawLog.length).toBe(rawLenBeforeAttack); // …proving nothing was logged by opening the pending
  s = attack.next;

  // ── Spot the prompt-privacy mechanism through a resync taken DURING the pending: the prompted defender sees the
  //    wire pending; the attacker (a non-prompted seat) does not. One line each, end-to-end through applyCommand. ──
  const defenderResync = applyCommand(s, { type: "resync" }, mkCtx(defenderOwner)).effects.reply[0]!;
  expect(defenderResync.type === "resync" && defenderResync.pending !== null).toBe(true);
  const attackerResync = applyCommand(s, { type: "resync" }, mkCtx(attackerSeat)).effects.reply[0]!;
  expect(attackerResync.type === "resync" && attackerResync.pending === null).toBe(true);

  // ── Resolve the decision as the prompted defender: ONE atomic put lands the attack log:N (+ its auto-close
  //    endRound + snapshot) together with the pending tombstone; the pending clears. This is the full human-defended
  //    attack flow through the interactive command path. ─────────────────────────────────────────────────────────
  const idxAttack = s.logLength;
  const resolve = applyCommand(
    s,
    { type: "resolveDecision", expectedLogIndex: idxAttack, decisionId: "hvh-decision", defender: hvhDecl.defender },
    mkCtx(defenderOwner),
  );
  const put = resolve.effects.persist!.put;
  expect(put).toHaveProperty(logKey(idxAttack)); // the attack entry
  expect((put[logKey(idxAttack)] as { kind: string }).kind).toBe("attack");
  expect(put).toHaveProperty(logKey(idxAttack + 1)); // auto-close endRound (the attacker is exhausted this round)
  expect((put[logKey(idxAttack + 1)] as { kind: string }).kind).toBe("endRound");
  expect(put).toHaveProperty(SNAPSHOT_KEY);
  expect(put[PENDING_KEY]).toBeDefined(); // the tombstone clears the pending in the SAME put
  expect(resolve.next.pending).toBeNull();
  absorb(rawLog, resolve.effects.persist!.put);
  s = resolve.next;

  // Drive whatever agent/eliminated rounds follow the resolved attack, up to the next human turn, to extend the
  // game a little past the pending (keeps the acceptance from being a bare setup+one-attack log). Bounded + snappy.
  for (let k = 0; k < 6; k += 1) {
    if (status(s.game).kind !== "ongoing") break;
    if (!needsDrive(s)) break; // stop at the next human turn — nothing to script, and we have our acceptance shape
    const r = driveOneStep(s, agentForSeat, { nowEpochMs: 2_000_000 + k, decisionId: `tail-${k}` });
    absorb(rawLog, r.effects.persist?.put ?? null);
    s = r.next;
    if (s.pending !== null) break; // an agent-vs-human pending would need a human answer — stop cleanly
  }

  // ── THE ACCEPTANCE: replay the accumulated RAW log from the header and require the reconstructed state to equal
  //    the reducer's own final game — structurally (toEqual, bigints intact) AND by the protocol's own divergence
  //    detector (stateHash). Plus logLength bookkeeping and attack non-vacuity. ────────────────────────────────────
  const replayed = replayLog(HEADER, rawLog);
  expect(rawLog.length).toBe(s.logLength); // every persisted entry absorbed, in order, none extra
  expect(rawLog.some((e) => e.kind === "attack"), "the accepted log genuinely contains the human-defended attack").toBe(true);
  expect(replayed.state).toEqual(s.game); // structural deep equality — the reducer log composes the exact state
  expect(stateHash(replayed.state)).toBe(stateHash(s.game)); // and the wire-fidelity hash agrees
});

// DISCRIMINATION (green-first, like the A4.5 cross-check): prove the acceptance's equivalence assertion is not
// vacuous by mutating the accumulated log and confirming replay diverges. We rebuild the SAME scripted game (a
// second independent run, so the mutation can't leak into the primary test's state), then drop a single entry from
// its raw log and assert the replayed state no longer matches the reducer's — the acceptance would catch a dropped
// or misordered entry. (Verified once at authoring time: dropping the last OR a middle entry diverges the hash.)
test("discrimination: dropping any single entry from the accepted raw log diverges the replay (the equivalence is non-vacuous)", () => {
  const rawLog: LogEntry[] = [];
  let s = openSession(HEADER, DEFAULT_ROOM_OPTIONS);
  s = completeSetup(s, rawLog);

  let hvhDecl: AttackDecl | null = null;
  let attackerSeat = -1;
  for (let played = 0; played < 200; played += 1) {
    if (status(s.game).kind !== "ongoing") break;
    const p = actor(s);
    if (needsDrive(s)) {
      const r = driveOneStep(s, agentForSeat, { nowEpochMs: 1_000_000 + played, decisionId: `drive-${played}` });
      absorb(rawLog, r.effects.persist?.put ?? null);
      s = r.next;
      if (s.pending !== null) break;
      continue;
    }
    const decl = humanVsHumanAttack(s, p);
    if (decl !== null) {
      hvhDecl = decl;
      attackerSeat = p;
      break;
    }
    const build = humanBuildTowardOpponent(s, p);
    const cmd = build !== null
      ? { type: "build" as const, expectedLogIndex: s.logLength, pieces: build }
      : { type: "pass" as const, expectedLogIndex: s.logLength };
    const r = applyCommand(s, cmd, mkCtx(p));
    absorb(rawLog, r.effects.persist!.put);
    s = r.next;
  }
  if (hvhDecl === null) throw new Error("BUG/regression: the scripted seed-2 sequence no longer reaches a human-vs-human attack");
  const defenderOwner = s.game.bases.find((b) => key(b.hex) === key(hvhDecl!.target))!.owner;

  s = applyCommand(s, { type: "attack", expectedLogIndex: s.logLength, decl: hvhDecl }, mkCtx(attackerSeat, "hvh-decision")).next;
  const resolve = applyCommand(
    s,
    { type: "resolveDecision", expectedLogIndex: s.logLength, decisionId: "hvh-decision", defender: hvhDecl.defender },
    mkCtx(defenderOwner),
  );
  absorb(rawLog, resolve.effects.persist!.put);
  s = resolve.next;

  // Sanity: the intact log replays exactly (same as the acceptance) — so the divergence below is caused by the
  // mutation, not by a pre-existing mismatch.
  expect(stateHash(replayLog(HEADER, rawLog).state)).toBe(stateHash(s.game));

  // Mutation: drop the FINAL entry (the auto-close endRound) → the replayed state must diverge.
  const droppedLast = rawLog.slice(0, rawLog.length - 1);
  expect(stateHash(replayLog(HEADER, droppedLast).state)).not.toBe(stateHash(s.game));

  // Mutation: drop a MIDDLE entry (a setup/build entry) → replay diverges too. replayLog installs each entry's
  // rngBeforeApply and applies it, so a removed entry shifts every subsequent apply — either a different hash or a
  // throw; both are divergence. Guard the throw case explicitly so the assertion is honest about what it accepts.
  let middleDiverges = false;
  try {
    const droppedMiddle = [...rawLog.slice(0, 5), ...rawLog.slice(6)];
    middleDiverges = stateHash(replayLog(HEADER, droppedMiddle).state) !== stateHash(s.game);
  } catch {
    middleDiverges = true;
  }
  expect(middleDiverges).toBe(true);
});
