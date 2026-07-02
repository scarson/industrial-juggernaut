// ABOUTME: Agent-drive loop — advances agent/eliminated rounds (logging each) until a human seat / pending / end.
// ABOUTME: Pure; takes agentForSeat + host ids injected. Agent attacks open a human pending or apply attack+endRound. Mirrors recordGame's composition.
import { applyEntry } from "./round";
import { stateHash } from "./hash";
import { encodeEntry } from "./codec";
import { openDefenderDecision } from "./pending";
import { status } from "../engine/status";
import { currentPlayer, representativeFirstBase } from "../engine/turn";
import { representativeDefender } from "../engine/legal";
import type { Agent } from "../agent/agent";   // import type only — no value import of src/agent here
import type { AttackDecl, PlayerId } from "../engine/types";
import type { LogEntry, SeatConfig } from "./types";
import type { ServerMessage } from "../wire/protocol";
import { key } from "../geometry/cube";
import { logKey, SNAPSHOT_KEY } from "./keys";
import { NO_EFFECTS, type CommandCtx, type Effects, type SessionState } from "./session-types";

/** The seat whose turn/placement it currently is (setup: the placer; play: the current player). Exported — A3 imports it. */
export function currentActor(s: SessionState): PlayerId {
  return s.game.phase.turn === 0 ? s.game.phase.order[s.game.phase.indexInOrder]! : currentPlayer(s.game);
}

/** True when the host should call driveOneStep (agent/eliminated actor, no pending, game live). */
export function needsDrive(s: SessionState): boolean {
  if (s.pending !== null) return false;
  if (status(s.game).kind === "victory") return false;
  const p = currentActor(s);
  if (s.game.phase.turn !== 0 && s.game.players[p]!.eliminated) return true;
  return s.header.seats[p]!.kind === "agent";
}

export type DriveResult = { next: SessionState; effects: Effects; advanced: boolean; terminal: ReturnType<typeof status> | null };
// terminal (when non-null) is a status() victory: { kind:"victory"; players: PlayerId[]; reason:"iron"|"last-standing" }.
// The gameOver message maps winners = terminal.players, cause = terminal.reason (no helper needed).

/** Advance exactly one agent/eliminated/setup round; return the entry(ies) to persist + broadcast.
 *  `ids` is the host-supplied non-determinism (time + a pre-generated decisionId) the attack branch needs to
 *  open a defender pending against a human seat — the reducer stays pure (no Date.now()/crypto). The acting seat
 *  is the agent player `p` itself (derived here), so `ids` is narrower than a full CommandCtx. The DO host calls
 *  `driveOneStep(s, agentForSeat, { nowEpochMs: Date.now(), decisionId: crypto.randomUUID() })` per wake. */
export function driveOneStep(
  s: SessionState,
  agentForSeat: (seat: SeatConfig) => Agent,
  ids: { nowEpochMs: number; decisionId: string },
): DriveResult {
  const p = currentActor(s);
  // SETUP: agent auto-places via representativeFirstBase (NOT via the injected agent).
  if (s.game.phase.turn === 0) {
    const entry: LogEntry = { player: p, kind: "placeFirstBase", hex: representativeFirstBase(s.game, p), rngBeforeApply: s.game.rngState };
    return commitEntries(s, [entry]); // placeFirstBase never closes a round (no chain possible in setup) → no snapshot, no clear
  }
  // PLAY, eliminated seat: roundSkipped (reachable with an open chain: the attacker died in its own losing attack).
  if (s.game.players[p]!.eliminated) {
    return clearChainOnClose(commitEntries(s, [{ player: p, kind: "roundSkipped", rngBeforeApply: s.game.rngState }]), s.chainAttacker);
  }
  // PLAY, agent seat: select + map to entries.
  const choice = agentForSeat(s.header.seats[p]!)(s.game, p);
  const rng = choice.state.rngState; // post-selection, pre-apply
  const a = choice.action;
  if (a.kind === "build") return clearChainOnClose(commitEntries(s, [{ player: p, kind: "build", pieces: a.pieces.map((x) => ({ type: x.type, hex: x.hex })), rngBeforeApply: rng }]), s.chainAttacker);
  if (a.kind === "pass") return clearChainOnClose(commitEntries(s, [{ player: p, kind: "pass", rngBeforeApply: rng }]), s.chainAttacker);
  return driveAttack(s, p, a.attacks, rng, ids);
}

/** Clear `chainAttacker` when the committed round closed — the "cleared on any round close" invariant
 *  (session-types.ts). commitEntries' `{...s}` spread carries the OLD value, so every close path through the
 *  drive must apply this (the mirror of session.ts's per-handler clear; commitEntries itself stays chain-agnostic).
 *  A dangling chain is reachable here: an agent-attacks-human resolution can leave the round OPEN with
 *  `chainAttacker` set, and the next drive step may close the round via build/pass/roundSkipped instead of
 *  another attack. */
function clearChainOnClose(result: DriveResult, prev: PlayerId | null): DriveResult {
  return { ...result, next: { ...result.next, chainAttacker: result.advanced ? null : prev } };
}

/** The agent attack branch. v1 agents emit exactly ONE declaration (mirrors recordGame's single-decl assert). When
 *  the defending seat is HUMAN the attack is NOT applied — a durable defender pending is opened and the drive halts
 *  (needsDrive then returns false; the human is prompted). When the defender is agent/auto the representative
 *  defender is substituted and the round is applied and ALWAYS closed (attack + endRound) in ONE atomic put —
 *  agents take exactly one attack per round in v1, matching recordGame. Unlike commitAttackRound (whose auto-close
 *  is CONDITIONAL, for a human continuing a chain), this path closes UNCONDITIONALLY. */
function driveAttack(
  s: SessionState,
  attacker: PlayerId,
  attacks: AttackDecl[],
  rng: SessionState["game"]["rngState"],
  ids: { nowEpochMs: number; decisionId: string },
): DriveResult {
  if (attacks.length !== 1) throw new Error("driveOneStep: v1 agents must emit single-declaration attacks");
  const proposed = attacks[0]!;
  const targetBase = s.game.bases.find((b) => key(b.hex) === key(proposed.target))!; // trusted agent: target exists
  const defenderOwner = targetBase.owner;

  // Human defender: open a durable pending and STOP driving — NO log entry (the attack applies on resolution).
  if (s.seats[defenderOwner]!.config.kind === "human") {
    const ctx: CommandCtx = { actingSeat: attacker, nowEpochMs: ids.nowEpochMs, decisionId: ids.decisionId };
    const { pending, effects } = openDefenderDecision(s, proposed, defenderOwner, ctx);
    // The drive halts: no round applied (advanced false, terminal null); the pending suppresses needsDrive.
    return { next: { ...s, pending }, effects, advanced: false, terminal: null };
  }

  // Agent/auto defender: substitute the deterministic representative defender, then apply attack + endRound.
  // Non-null `!`: the guarantee comes from legalActions (src/engine/legal.ts skips any target whose
  // representativeDefender is null), not a local check — the trusted agent chose from legalActions.
  const defender = representativeDefender(s.game, proposed.target, defenderOwner)!;
  const finalDecl: AttackDecl = { ...proposed, defender };
  const attackEntry: LogEntry = { player: attacker, kind: "attack", decl: finalDecl, rngBeforeApply: rng };
  // endRound's rngBeforeApply is the POST-ATTACK state's rng — apply the attack to a THROWAWAY to read it (the
  // same pattern commitAttackRound uses; applyEntry is pure, so the real apply inside commitEntries reproduces it).
  const postAttackRng = applyEntry(s.game, attackEntry).state.rngState;
  const endRoundEntry: LogEntry = { player: attacker, kind: "endRound", rngBeforeApply: postAttackRng };
  const result = commitEntries(s, [attackEntry, endRoundEntry]); // ONE atomic put: attack + endRound + snapshot
  return clearChainOnClose(result, s.chainAttacker); // endRound always closes → the chain always clears here
}

/** Apply a round's entries through applyEntry, threading state; build the atomic PersistOp + broadcasts.
 *  EXPORTED — the SHARED builder reused by A3 (human build/pass/endRound) and A4 (attack), so the
 *  applyEntry→{persist,broadcast,snapshot} logic exists in exactly one place (DRY). */
export function commitEntries(s: SessionState, entries: LogEntry[]): DriveResult {
  let game = s.game;
  let logLength = s.logLength;
  let advanced = false;
  let terminal: ReturnType<typeof status> | null = null;
  const put: Record<string, unknown> = {};
  const broadcast: ServerMessage[] = [];
  // Caller contract: at most the FINAL entry closes/terminates the round, so each call emits at most
  // one snapshot and one turnRollover/gameOver (e.g. an A4 attack chain ends with its endRound last).
  for (const entry of entries) {
    const out = applyEntry(game, entry);
    put[logKey(logLength)] = entry;                 // RAW entry (bigints store natively in DO storage)
    broadcast.push({ type: "applied", entry: encodeEntry(entry), events: out.events, logIndex: logLength });
    game = out.state;
    logLength += 1;
    if (out.advanced) advanced = true;
    if (out.terminal) terminal = out.terminal;       // a victory-closing round: applyEntry did NOT advanceRound
  }
  if (advanced) {
    // Snapshot holds post-composition state (post-advanceRound for a normal close; the victory state for a
    // terminal close, where applyEntry deliberately skips advanceRound — round.ts).
    put[SNAPSHOT_KEY] = { state: game, logIndex: logLength - 1, stateHash: stateHash(game), replayVersion: s.header.replayVersion };
    if (terminal !== null && terminal.kind === "victory") {
      // Game over: there is NO next turn — do NOT broadcast turnRollover (game.phase.order is the final round's order).
      // status() victory shape (src/engine/status.ts): { kind:"victory"; players: PlayerId[]; reason:"iron"|"last-standing" }.
      // `players` is the winning coalition (EMPTY [] for an all-eliminated/no-winner board, DER-N7 / status.ts:116).
      broadcast.push({ type: "gameOver", winners: terminal.players, cause: terminal.reason });
    } else {
      broadcast.push({ type: "turnRollover", order: game.phase.order, ironWeights: null }); // ironWeights filled in A6
    }
  }
  const next: SessionState = { ...s, game, logLength };
  const effects: Effects = { ...NO_EFFECTS, persist: { put }, broadcast };
  return { next, effects, advanced, terminal };
}
