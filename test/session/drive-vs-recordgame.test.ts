// ABOUTME: Reducer-drive == recordGame for all-agent games (non-tautological: independent implementations).
// ABOUTME: The single highest-value correctness anchor in Part A — asserts log + boundary-hash parity, attack non-vacuity, and the gameOver mechanism.
import { test, expect } from "vitest";
import { recordGame, type RecordResult } from "../../src/session/record";
import { openSession } from "../../src/session/session";
import { needsDrive, driveOneStep } from "../../src/session/agent-drive";
import { agentForSeat } from "../../src/session/agent-binding";
import { stateHash } from "../../src/session/hash";
import { status } from "../../src/engine/status";
import { defaultConfig, type RuleConfig } from "../../src/engine/config";
import { DEFAULT_ROOM_OPTIONS } from "../../src/wire/protocol";
import type { LogEntry, SeatConfig, SessionHeader } from "../../src/session/types";
import type { ServerMessage } from "../../src/wire/protocol";

// Host-supplied non-determinism for driveOneStep. In an ALL-AGENT game the attack branch never opens a pending
// (every defender is an agent → representativeDefender substitution, no human prompt), so `nowEpochMs`/`decisionId`
// are never actually consumed — but the signature requires them. Vary them per step anyway (deterministically) to
// prove they do not leak into the log/hash: if any drive step DID read them, the parity assertion would break.
function idsForStep(step: number): { nowEpochMs: number; decisionId: string } {
  return { nowEpochMs: 1_000_000 + step, decisionId: `d-${step}` };
}

// ── Stopping-condition reconciliation (record.ts ↔ agent-drive.ts) ───────────────────────────────────────────
// recordGame (src/session/record.ts) and the interactive drive (needsDrive/driveOneStep, matching applyCommand) are
// INDEPENDENT implementations. Their per-entry COMPOSITION is identical — the whole point of this cross-check — but
// they use slightly different STOPPING RULES, which must be reconciled so the comparison is exact:
//
//   (1) VICTORY MID-GAME — a round-closing entry whose applyEntry reports terminal (record.ts:48/54/56/60). The drive
//       loop sees this as driveOneStep(...).terminal !== null and breaks. Same point: recordGame stops AT the entry
//       that terminated; the drive loop's LAST pushed entry is that same terminating entry. Full log parity holds.
//   (2) TURN CAP — recordGame checks `state.phase.turn > opts.turnCap` at the BOTTOM of each for(;;) iteration
//       (record.ts:63), i.e. AFTER a full actor round has been applied, using strict `>`. Because driveOneStep advances
//       exactly ONE actor's round per call (build/pass = one entry; attack = attack+endRound atomically — the same
//       single-decl composition recordGame uses), the drive loop mirrors this by checking `s.game.phase.turn > turnCap`
//       after each step, with the identical strict `>`. Both therefore stop at the first round-boundary that pushes
//       phase.turn past the cap. Full log parity holds.
//   (3) BORN-TERMINAL / MID-SETUP VICTORY — this is the ONE place the two stopping rules legitimately differ, and it
//       is a benign SETUP-ONLY difference, NOT a composition defect (verified: in every affected case the drive log is
//       an exact bit-for-bit PREFIX of recordGame's, and recordGame's dropped tail is PURELY `placeFirstBase` entries):
//         • recordGame places EVERY seat's first base unconditionally (`while (state.phase.turn === 0)`, record.ts:38),
//           and only THEN checks born-terminal victory (record.ts:43). So it always logs N placements for N seats.
//         • The interactive drive stops the moment an iron victory materializes: the clinching placeFirstBase's
//           commitEntries runs status() on the post-placement state and, on victory, reports terminal AND broadcasts a
//           single gameOver (agent-drive.ts — the placement-batch status check that dissolves the B3 host obligation).
//           The drive loop breaks on that terminal signal (`r.terminal !== null`), same as a mid-GAME victory. This is
//           CORRECT for interactive play, because applyCommand ALSO rejects every mutating command (including a
//           placeFirstBase) once status()==victory with GAME_OVER (session.ts:87). In a 4-player game a single
//           well-placed first base can already control ≥ victoryThreshold iron, so an iron victory can be decided after
//           only 2 of 4 placements; the remaining seats can NEVER place in the interactive/DO-host world (their
//           placeFirstBase would be GAME_OVER-rejected). recordGame's extra tail placements are therefore genuinely
//           UNREACHABLE interactively.
//         Reconciliation (exact, not a weakening): when the drive stops while still in setup (`droveStoppedInSetup`),
//         assert `drive.log === rg.log.slice(0, drive.log.length)` (exact prefix, bigints included) AND that the
//         dropped tail `rg.log.slice(drive.log.length)` is entirely `placeFirstBase` — proving nothing but redundant
//         post-victory setup placements were truncated. Otherwise assert full `drive.log === rg.log`. AND, because the
//         clinching placement now emits a gameOver, assert exactly ONE gameOver at the terminal step with NO
//         turnRollover (a placement never closes a round) — the mid-setup analogue of Obligation A below.
//
// An all-agent session never legitimately halts on a pending (agents defend via representativeDefender, never a human
// prompt), and every victory — mid-game, born-terminal, or mid-setup — now surfaces through the terminal signal. So
// needsDrive going false WITHOUT a terminal or a cap would be a STALL, itself a divergence: the `exit === null`
// fallthrough in driveToStop asserts that case is a victory purely as a stall tripwire (unreachable on the happy path).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type DriveOutcome = {
  log: LogEntry[];
  hashes: string[];
  terminal: ReturnType<typeof status> | null; // the driveOneStep terminal (victory closing a round mid-game), or null
  exit: "terminal" | "setup-victory" | "cap";
  droveStoppedInSetup: boolean; // true iff the drive stopped while still in the setup phase (phase.turn === 0)
  broadcasts: ServerMessage[][]; // per-step broadcast arrays, aligned to the driven steps (for the gameOver assertion)
};

/** Reducer drive: open a session and drive it with the REAL agentForSeat until it stops at the SAME point the
 *  interactive path (applyCommand) would. Accumulate the RAW log:N entries (bigints intact) and a boundary stateHash
 *  on every advancing step. */
function driveToStop(header: SessionHeader, turnCap: number): DriveOutcome {
  let s = openSession(header, DEFAULT_ROOM_OPTIONS);
  const log: LogEntry[] = [];
  const hashes: string[] = [];
  const broadcasts: ServerMessage[][] = [];
  let terminal: ReturnType<typeof status> | null = null;
  let exit: DriveOutcome["exit"] | null = null;
  let step = 0;
  const MAX_STEPS = 100_000; // hard bound so a composition bug can't spin forever

  while (needsDrive(s)) {
    if (step >= MAX_STEPS) throw new Error("driveToStop: exceeded MAX_STEPS — the drive loop is not terminating");
    const r = driveOneStep(s, agentForSeat, idsForStep(step));
    // Push the RAW log:N entries in numeric key order (padStart makes lexical order == numeric order).
    const put = r.effects.persist?.put ?? {};
    const logKeys = Object.keys(put).filter((k) => k.startsWith("log:")).sort();
    for (const k of logKeys) log.push(put[k] as LogEntry);
    if (r.advanced) hashes.push(stateHash(r.next.game));
    broadcasts.push(r.effects.broadcast);
    s = r.next;
    step += 1;
    if (r.terminal !== null) { terminal = r.terminal; exit = "terminal"; break; }
    if (s.game.phase.turn > turnCap) { exit = "cap"; break; }
  }

  const droveStoppedInSetup = s.game.phase.turn === 0;
  if (exit === null) {
    // The loop fell out because needsDrive went false WITHOUT a terminal or a cap. Every victory — mid-game,
    // born-terminal, and mid-setup — now surfaces through the terminal signal (driveOneStep's clinching placement
    // reports terminal, breaking the loop above with exit "terminal"), so on the happy path this branch is
    // UNREACHABLE. Reaching it means needsDrive went false with no victory signalled — a genuine STALL (e.g. an
    // unexpected pending). Assert a victory here purely as the stall tripwire; label the exit setup-victory so a
    // future regression that resurrected the silent-victory path (needsDrive-false-without-terminal) is still caught.
    const st = status(s.game);
    expect(st.kind, `drive loop stalled: needsDrive false but no terminal signalled (turn=${s.game.phase.turn}, pending=${s.pending !== null})`).toBe("victory");
    exit = "setup-victory";
  }
  return { log, hashes, terminal, exit, droveStoppedInSetup, broadcasts };
}

// ── Header builders ──────────────────────────────────────────────────────────────────────────────────────────
function header(seats: SeatConfig[], seed: bigint, config: RuleConfig): SessionHeader {
  return { formatVersion: 1, replayVersion: "test", seed, config, boardSource: { kind: "generate", size: 96, ironCount: 14 }, seats };
}
const eco = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "economic" });
const agg = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "aggressive" });
const exp = (): SeatConfig => ({ kind: "agent", agent: "greedy", archetype: "expansionist" });
const heu = (): SeatConfig => ({ kind: "agent", agent: "heuristic" });

// Two configs. The DEFAULT config is the vanilla ruleset (games decide fast, usually by an iron victory in 1-2 turns
// — zero attacks reachable, per the agent-drive smoke comment). The PROLONGED config raises `victoryThreshold` (the
// controlled-iron count needed for an iron victory; src/engine/config.ts). This is a legal RuleConfig header input,
// shared BIT-IDENTICALLY by both recordGame and the drive (both call initGame with header.config), so it can never
// weaken the parity check — it only selects a longer game. At the default threshold of 10, games end before combat
// develops; at 20 they run ~13-24 rounds and agents genuinely attack (probed). It is the minimally-invasive knob:
// no combat/board/piece rule changes, just the finish line.
const DEFAULT_CONFIG: RuleConfig = defaultConfig();
const PROLONGED_CONFIG: RuleConfig = { ...defaultConfig(), victoryThreshold: 20 };

/** One compared case: build the header, run recordGame, run the reducer drive to the SAME stop, and assert log +
 *  boundary-hash parity. Applies the born-terminal / mid-setup-victory reconciliation (case (3) above): when the drive
 *  legitimately stopped while still in setup, recordGame's log carries EXTRA `placeFirstBase` entries the interactive
 *  path can never produce (they'd be GAME_OVER-rejected, session.ts:87), so the exact comparison truncates recordGame's
 *  log to what the drive produced and separately proves the truncated tail is redundant setup-only. */
function assertParity(name: string, seats: SeatConfig[], seed: bigint, config: RuleConfig, turnCap: number): { rg: RecordResult; drive: DriveOutcome } {
  const hdr = header(seats, seed, config);
  const rg = recordGame(hdr, { turnCap });
  const drive = driveToStop(hdr, turnCap);

  // Compute the reconciled expected log + hashes. In the common case this is recordGame's full log/hashes. In the
  // mid-setup-victory case ONLY, truncate to the drive length — and HARD-assert the dropped tail is exclusively
  // `placeFirstBase` (redundant post-victory placements), so the truncation can never hide a real composition defect.
  let expectedLog = rg.log;
  let expectedHashes = rg.boundaryHashes;
  if (drive.droveStoppedInSetup) {
    const tail = rg.log.slice(drive.log.length);
    expect(tail.length, `[${name}] mid-setup stop must only truncate recordGame's redundant tail`).toBeGreaterThan(0);
    expect(tail.every((e) => e.kind === "placeFirstBase"), `[${name}] the truncated recordGame tail is ONLY placeFirstBase (redundant post-victory setup placements); tail kinds: [${tail.map((e) => e.kind).join(",")}]`).toBe(true);
    // recordGame produced NO round boundaries in these games (setup + immediate born-terminal → zero advanceRound),
    // so its boundaryHashes are empty and the drive's are too; slicing is a no-op but keep it exact.
    expectedLog = rg.log.slice(0, drive.log.length);
    expectedHashes = rg.boundaryHashes.slice(0, drive.hashes.length);

    // NEW BEHAVIOR (mid-setup gameOver — the B3 obligation now dissolved in commitEntries): the clinching
    // placeFirstBase reports terminal and broadcasts a single gameOver. Pin it — the mid-setup analogue of
    // Obligation A. Exactly ONE gameOver across the whole driven game, at the terminal (last) step, with NO
    // turnRollover there (a placement never closes a round → no advanceRound → no rollover), and winners/cause
    // matching the drive's captured terminal (which IS status() of the drive's final state at the clinching step).
    expect(drive.exit, `[${name}] a mid-setup victory now surfaces through the terminal signal`).toBe("terminal");
    expect(drive.terminal, `[${name}] the drive captured the mid-setup terminal`).not.toBeNull();
    const midSetupTerminal = drive.terminal as Extract<ReturnType<typeof status>, { kind: "victory" }>;
    expect(midSetupTerminal.kind).toBe("victory");
    const allGameOvers = drive.broadcasts.flat().filter((m) => m.type === "gameOver");
    expect(allGameOvers, `[${name}] exactly one gameOver across the whole mid-setup game`).toHaveLength(1);
    const terminalStep = drive.broadcasts[drive.broadcasts.length - 1]!;
    expect(terminalStep.filter((m) => m.type === "gameOver"), `[${name}] the gameOver is at the terminal step`).toHaveLength(1);
    expect(terminalStep.some((m) => m.type === "turnRollover"), `[${name}] no turnRollover at a mid-setup victory`).toBe(false);
    const midSetupGameOver = allGameOvers[0] as Extract<ServerMessage, { type: "gameOver" }>;
    expect(midSetupGameOver.winners, `[${name}] mid-setup gameOver winners == terminal.players`).toEqual(midSetupTerminal.players);
    expect(midSetupGameOver.cause, `[${name}] mid-setup gameOver cause == terminal.reason`).toBe(midSetupTerminal.reason);
  }

  // Bit-for-bit log parity — the RAW entry arrays (rngBeforeApply bigints included). On a mismatch, surface the first
  // diverging index and both entries so a real drive-composition defect is fully repro'd (assertion-rigor: NEVER a
  // hash-only or length-only fallback).
  if (JSON.stringify(drive.log, bigintReplacer) !== JSON.stringify(expectedLog, bigintReplacer)) {
    const n = Math.max(drive.log.length, expectedLog.length);
    for (let i = 0; i < n; i++) {
      const a = JSON.stringify(drive.log[i] ?? null, bigintReplacer);
      const b = JSON.stringify(expectedLog[i] ?? null, bigintReplacer);
      if (a !== b) {
        throw new Error(`[${name}] log divergence at index ${i} (seed=${seed}):\n  drive: ${a}\n  record: ${b}\n  (drive.length=${drive.log.length}, expected.length=${expectedLog.length}, drive.exit=${drive.exit}, droveStoppedInSetup=${drive.droveStoppedInSetup})`);
      }
    }
  }
  expect(drive.log, `[${name}] log deep-equality`).toEqual(expectedLog);
  expect(drive.hashes, `[${name}] boundary-hash parity`).toEqual(expectedHashes);
  return { rg, drive };
}

// stateHash bigints don't appear in the LOG, but rngBeforeApply (a RngState of two bigints) does — JSON.stringify
// needs a replacer to serialize bigints for the diagnostic diff above. (The toEqual assertion compares the raw
// objects directly and is unaffected.)
function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? `${v}n` : v;
}

// ── Obligation C: multi-mix coverage ─────────────────────────────────────────────────────────────────────────
// At least: one 2p all-greedy, one 3p all-heuristic, one 4p mixed (greedy archetypes varied + heuristic). Several
// seeds for at least one mix. We run BOTH configs where sensible: DEFAULT proves the vanilla ruleset's short games
// stay in parity (mostly the setup + born/early-victory path); PROLONGED proves the LONG, attack-heavy games stay
// in parity (the attack composition — the whole point of a non-tautological cross-check).

const SEEDS = [1n, 2n, 3n, 7n, 11n];

test("2p all-greedy: reducer drive == recordGame (default config, several seeds)", () => {
  for (const s of SEEDS) assertParity("2p-greedy-default", [eco(), eco()], s, DEFAULT_CONFIG, 200);
});

test("3p all-heuristic: reducer drive == recordGame (default config, several seeds)", () => {
  for (const s of SEEDS) assertParity("3p-heuristic-default", [heu(), heu(), heu()], s, DEFAULT_CONFIG, 200);
});

test("4p mixed (greedy archetypes varied + heuristic): reducer drive == recordGame (default config, several seeds)", () => {
  for (const s of SEEDS) assertParity("4p-mixed-default", [agg(), exp(), eco(), heu()], s, DEFAULT_CONFIG, 200);
});

test("3p all-heuristic: reducer drive == recordGame (prolonged config — long attack-heavy games, several seeds)", () => {
  for (const s of SEEDS) assertParity("3p-heuristic-prolonged", [heu(), heu(), heu()], s, PROLONGED_CONFIG, 200);
});

test("4p mixed: reducer drive == recordGame (prolonged config — long attack-heavy games, several seeds)", () => {
  for (const s of SEEDS) assertParity("4p-mixed-prolonged", [agg(), heu(), exp(), heu()], s, PROLONGED_CONFIG, 200);
});

// ── Obligation B: attack-path NON-VACUITY ────────────────────────────────────────────────────────────────────
// Default-config all-agent games terminate in 1-2 rounds by an iron victory — ZERO attacks — which would make the
// attack path of this cross-check vacuous. Raising victoryThreshold to 20 prolongs games to ~13-24 rounds; the
// heuristic-3p and mixed-4p prolonged cases (probed) then genuinely attack (17-35 attacks each). Assert the compared
// logs contain attack entries as a HARD test assertion — if a future engine/agent change silences agent attacks, this
// fails loudly rather than passing vacuously. (Cases that produce attacks: every PROLONGED case above.)
test("attack non-vacuity: the compared logs contain agent attack entries (else this cross-check is vacuous)", () => {
  let totalAttacks = 0;
  const perCase: string[] = [];
  const cases: Array<{ name: string; seats: SeatConfig[]; seeds: bigint[] }> = [
    { name: "3p-heuristic-prolonged", seats: [heu(), heu(), heu()], seeds: SEEDS },
    { name: "4p-mixed-prolonged", seats: [agg(), heu(), exp(), heu()], seeds: SEEDS },
  ];
  for (const c of cases) {
    for (const s of c.seeds) {
      const { rg, drive } = assertParity(c.name, c.seats, s, PROLONGED_CONFIG, 200);
      const rgAttacks = rg.log.filter((e) => e.kind === "attack").length;
      const driveAttacks = drive.log.filter((e) => e.kind === "attack").length;
      // Parity already proven log-equal above, so these are equal by construction — assert it anyway (defensive).
      expect(driveAttacks, `${c.name} seed ${s}: attack counts match across the two paths`).toBe(rgAttacks);
      totalAttacks += rgAttacks;
      if (rgAttacks > 0) perCase.push(`${c.name}@${s}:${rgAttacks}`);
    }
  }
  // HARD assertion: the attack path is exercised. Documented producing cases: see perCase in the failure message.
  expect(totalAttacks, `attack-path non-vacuity — attacks by case: [${perCase.join(" ")}]`).toBeGreaterThan(0);
});

// ── Obligation A: gameOver mechanism (the silent-victory regression guard, deferred from A2.4) ────────────────
// For a seed whose game reaches a REAL victory (not the turnCap), the reducer drive must emit EXACTLY ONE gameOver
// broadcast across the whole game, at the terminal step, whose winners/cause match status() of the final state AND
// rg's outcome; and NO turnRollover at that terminal step (the victory round does not advanceRound). This is the
// only place a win is communicated — without the assertion, a silent-victory regression could return.
test("gameOver mechanism: exactly one gameOver at the terminal step, matching status(); no turnRollover there", () => {
  // A prolonged 3p-heuristic game that reaches a real last-standing victory (probed: seed 7, ~19 rounds, decisive).
  const seats = [heu(), heu(), heu()];
  const seed = 7n;
  const hdr = header(seats, seed, PROLONGED_CONFIG);
  const rg = recordGame(hdr, { turnCap: 300 });
  expect(rg.hitTurnCap, "precondition: this case must reach a REAL victory, not the turn cap").toBe(false);

  const drive = driveToStop(hdr, 300);
  // The drive must have stopped via a mid-game terminal (a victory closing a round), not the cap or a born-terminal.
  expect(drive.exit, "the game reaches a mid-game victory").toBe("terminal");
  expect(drive.terminal, "the drive captured the terminal status").not.toBeNull();
  expect(drive.terminal!.kind).toBe("victory");

  // EXACTLY ONE gameOver across the WHOLE game.
  const allBroadcasts = drive.broadcasts.flat();
  const gameOvers = allBroadcasts.filter((m) => m.type === "gameOver");
  expect(gameOvers, "exactly one gameOver broadcast across the whole game").toHaveLength(1);

  // It occurs at the TERMINAL step (the last driven step), and there is NO turnRollover in that step's broadcasts.
  const terminalStep = drive.broadcasts[drive.broadcasts.length - 1]!;
  expect(terminalStep.filter((m) => m.type === "gameOver"), "the gameOver is at the terminal step").toHaveLength(1);
  expect(terminalStep.some((m) => m.type === "turnRollover"), "no turnRollover at the victory step (victory skips advanceRound)").toBe(false);

  // winners/cause match status() of the final state — reconstruct the final state by replaying the drive log through
  // recordGame's finalState (already proven log-equal), and compare against both the broadcast and rg's outcome.
  const finalStatus = status(rg.finalState) as Extract<ReturnType<typeof status>, { kind: "victory" }>;
  const gameOver = gameOvers[0] as Extract<ServerMessage, { type: "gameOver" }>;
  expect(gameOver.winners, "gameOver winners == status().players").toEqual(finalStatus.players);
  expect(gameOver.cause, "gameOver cause == status().reason").toBe(finalStatus.reason);
  // And rg's own terminal status agrees (independent path).
  expect(drive.terminal!.kind === "victory" ? (drive.terminal as Extract<ReturnType<typeof status>, { kind: "victory" }>).players : null, "drive terminal winners == status().players").toEqual(finalStatus.players);
});
