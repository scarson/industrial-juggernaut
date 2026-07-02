// ABOUTME: The interactive GameSession reducer core — openSession, the applyCommand envelope + command handlers, resyncPayload.
// ABOUTME: Pure: every state-changing call returns { next, effects }; the host performs the effects.
import { initGame } from "../engine/init";
import { currentActor, commitEntries } from "./agent-drive";
import { status } from "../engine/status";
import { representativeDefender } from "../engine/legal";
import { encodeState } from "../wire/codec";
import { validateAttackDecl, validateBuildPieces, validatePass, validateTargetAttackable } from "./validation";
import {
  commitAttackRound,
  extendDefender,
  openDefenderDecision,
  resolveDefender,
  validateAttackers,
} from "./pending";
import { key } from "../geometry/cube";
import { claimSeat, seatRoster } from "./seats";
import type { AttackDecl, PlayerId } from "../engine/types";
import type { LogEntry, SessionHeader } from "./types";
import { PROTOCOL_VERSION, type ClientCommand, type RoomOptions, type ServerMessage, type WireErrorCode } from "../wire/protocol";
import { NO_EFFECTS, type CommandCtx, type Effects, type SessionState } from "./session-types";

export function openSession(header: SessionHeader, roomOptions: RoomOptions): SessionState {
  const game = initGame({
    seed: header.seed, boardSource: header.boardSource,
    nPlayers: header.seats.length, config: header.config,
  });
  return {
    header, roomOptions, game, logLength: 0, pending: null, chainAttacker: null,
    seats: header.seats.map((config, seat) => ({ seat, config, authorizedDigest: null, claimed: false, lastRequestId: null })),
  };
}

// Mutating = appends a log entry / changes authoritative state. resolveDecision is mutating (it applies the
// attack); extendDecision is NOT (it only re-arms the alarm), so it is exempt from the envelope guards and the
// write-lock. hello/claimSeat/resync are also non-mutating.
const MUTATING_TYPES: ReadonlySet<ClientCommand["type"]> = new Set(["placeFirstBase","build","attack","endRound","pass","resolveDecision"]);
function isMutating(c: ClientCommand): boolean { return MUTATING_TYPES.has(c.type); }
function errorMessage(code: WireErrorCode, message: string, currentLogIndex: number | null = null): ServerMessage {
  return { type: "error", code, message, currentLogIndex };
}
function errorEffects(s: SessionState, code: WireErrorCode, message: string): Effects {
  return { ...NO_EFFECTS, reply: [errorMessage(code, message, s.logLength)] };
}
function resyncEffects(s: SessionState, requestingSeat: number, reason: string): Effects {
  return { ...NO_EFFECTS, reply: [resyncPayload(s, requestingSeat, reason)] };
}

/** Maps an engine `placeFirstBase` thrown message (src/engine/turn.ts) to a WireErrorCode. The client teaching
 *  surface maps codes -> explanations, so distinct engine failures MUST stay distinct codes here — never collapse.
 *  Returns null for an unrecognized message — the caller rethrows: unknown throws are reducer/engine bugs, not
 *  client errors, and must stay loud (MALFORMED is reserved for transport-layer malformed traffic). */
function placeFirstBaseErrorCode(message: string): WireErrorCode | null {
  if (message.includes("not in setup phase")) return "NOT_IN_SETUP";
  if (message.includes("not this player's setup turn")) return "NOT_YOUR_TURN";
  if (message.includes("hex is not on the board")) return "HEX_OFF_BOARD";
  if (message.includes("hex must be an outermost-ring hex")) return "HEX_NOT_OUTER";
  if (message.includes("hex is already occupied")) return "HEX_OCCUPIED";
  return null;
}

/** Maps a `SessionError.code` from validateBuildPieces (src/session/validation.ts) to its WireErrorCode. The
 *  validation codes are authored to match the catalog string-for-string, so this is an identity narrowing —
 *  it exists to keep the string→WireErrorCode cast in one audited place. */
function buildValidationErrorCode(code: string): WireErrorCode {
  return code as WireErrorCode; // MIXED_PIECE_TYPES / DUP_PIECES — both in WIRE_ERROR_CODES
}

/** Maps an engine `applyBuild` thrown message (src/engine/apply.ts) to a WireErrorCode. Budget and placement
 *  are the ENGINE's job at apply time (A3.2 policy — the reducer does NOT pre-check them), so these throws are
 *  a NORMAL client-error path, not a bug. Each distinct client-explainable rule violation maps to its own code
 *  (the client teaches from the code). "all pieces must be the same type" is intentionally absent: the reducer's
 *  validateBuildPieces catches MIXED_PIECE_TYPES before the entry is built, so that throw is unreachable via the
 *  wire and RETHROWS (null) as a reducer/engine invariant breach. */
function buildEngineErrorCode(message: string): WireErrorCode | null {
  if (message.includes("pieces must be non-empty")) return "BUILD_EMPTY";
  if (message.includes("bootstrap budget is factory-only")) return "BUILD_BOOTSTRAP_FACTORY_ONLY";
  if (message.includes("exceeds build budget")) return "BUILD_OVER_BUDGET";
  if (message.includes("illegal factory placement")) return "BUILD_ILLEGAL_FACTORY";
  if (message.includes("no bases in hand to place")) return "BUILD_NO_BASES_IN_HAND";
  if (message.includes("illegal base placement")) return "BUILD_ILLEGAL_BASE";
  return null;
}

export function applyCommand(s: SessionState, c: ClientCommand, ctx: CommandCtx): { next: SessionState; effects: Effects } {
  const keep = (effects: Effects) => ({ next: s, effects });   // rejected/no-op commands leave state unchanged
  if (isMutating(c)) {
    if (status(s.game).kind === "victory") return keep(errorEffects(s, "GAME_OVER", "The game is over."));
    if (s.pending !== null) {
      // WRITE-LOCK CARVE-OUT: while a pending decision holds the lock, the ONLY mutating command that gets
      // through is a resolveDecision for THIS decision, from the prompted DEFENDER seat. Note the carve-out is
      // what forces the NOT_YOUR_TURN check below to authorize against `s.pending.promptedSeat` rather than
      // `currentActor` — during a pending the current actor is still the ATTACKER, but the legitimate resolver
      // is the prompted defender. A mismatched resolveDecision id means the decision was already resolved and a
      // new one may exist (or none) → ALREADY_RESOLVED; any other mutating command is simply locked out.
      if (c.type !== "resolveDecision" || c.decisionId !== s.pending.decisionId) {
        if (c.type === "resolveDecision") return keep(errorEffects(s, "ALREADY_RESOLVED", "That decision is no longer pending."));
        return keep(errorEffects(s, "DECISION_PENDING", "A decision is pending."));
      }
      // A matching resolveDecision still carries expectedLogIndex — the STALE_INDEX guard still applies (the
      // pending opened without appending, so logLength is unchanged since the prompt; a resync-then-retry client
      // resends the same index).
      if (c.expectedLogIndex !== s.logLength) return keep(resyncEffects(s, ctx.actingSeat, "STALE_INDEX"));
      // Agent-seat backstop (defense in depth, resolved 2026-07-02 — see plan Discoveries "Agent-seat auth
      // boundary"): openDefenderDecision only fires for HUMAN defenders (an agent/auto defender is substituted
      // and applied immediately in the attack handler), so s.pending.promptedSeat is human-by-construction
      // today. This check can never trip via a legitimate path — it exists so a future promptedSeat source
      // can't silently reopen the hole this backstop closes. The host's own agent drive never calls
      // applyCommand (driveOneStep/commitEntries only), so this cannot affect legitimate agent play.
      if (s.seats[s.pending.promptedSeat]?.config.kind === "agent") {
        return keep(errorEffects(s, "NOT_YOUR_TURN", "Agent seats are host-driven."));
      }
      // Seat auth against the PROMPTED seat, not currentActor — only the defender may resolve their own decision.
      if (ctx.actingSeat !== s.pending.promptedSeat) return keep(errorEffects(s, "NOT_YOUR_TURN", "It is not your decision to resolve."));
      // Falls through to the resolveDecision case below (authorized).
    } else {
      if ("expectedLogIndex" in c && c.expectedLogIndex !== s.logLength) return keep(resyncEffects(s, ctx.actingSeat, "STALE_INDEX"));
      // Agent-seat backstop (defense in depth, resolved 2026-07-02 — see plan Discoveries "Agent-seat auth
      // boundary"): an agent seat CAN be currentActor (it's the agent's turn), so a rogue socket bound to that
      // seat would PASS the currentActor check below — this must run regardless of the turn check's outcome.
      // Legitimate clients never reach this: B2.2 mints seat tokens for human seats only and the WS upgrade
      // refuses to bind a socket to an agent seat, so this state is unreachable once those layers land — this
      // is a backstop, not a teaching surface. The host's own agent drive never calls applyCommand
      // (driveOneStep/commitEntries only), so this cannot affect legitimate agent play.
      if (s.seats[ctx.actingSeat]?.config.kind === "agent") {
        return keep(errorEffects(s, "NOT_YOUR_TURN", "Agent seats are host-driven."));
      }
      if (ctx.actingSeat !== currentActor(s)) return keep(errorEffects(s, "NOT_YOUR_TURN", "It is not your turn."));
      // During setup (turn 0) the ONLY legal mutating command is placeFirstBase (recordGame's composition).
      // Without this, a forced pass from an unplaced placer passes validatePass (legalActions' stuck fallback)
      // and reaches advanceRound, which THROWS on any turn-0 state (src/engine/turn.ts) — an uncaught crash on
      // a legitimate wire command. Placed AFTER NOT_YOUR_TURN so it fires only for the in-turn, fresh-index seat.
      // (A pending can never exist at turn 0 — attacks are impossible in setup — so this only runs in the
      // no-pending branch, which is correct.)
      if (s.game.phase.turn === 0 && c.type !== "placeFirstBase") {
        return keep(errorEffects(s, "SETUP_PLACEMENT_REQUIRED", "Setup is in progress — place your first base."));
      }
    }
  }
  switch (c.type) {
    case "placeFirstBase": {
      const entry: LogEntry = { player: ctx.actingSeat, kind: "placeFirstBase", hex: c.hex, rngBeforeApply: s.game.rngState };
      try {
        const result = commitEntries(s, [entry]); // applyEntry runs the engine placeFirstBase — same throw surface, single apply path
        return { next: result.next, effects: result.effects };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = placeFirstBaseErrorCode(message);
        if (code === null) throw err;
        return keep(errorEffects(s, code, message));
      }
    }
    case "build": {
      // Defense-in-depth §5: reject mixed-type / duplicate-hex builds BEFORE composing the entry. Budget and
      // placement legality are NOT pre-checked here — they are the engine's job at apply time (A3.2 policy).
      const validationError = validateBuildPieces(c.pieces);
      if (validationError !== null) {
        return keep(errorEffects(s, buildValidationErrorCode(validationError.code), validationError.message));
      }
      const entry: LogEntry = { player: ctx.actingSeat, kind: "build", pieces: c.pieces, rngBeforeApply: s.game.rngState };
      try {
        const result = commitEntries(s, [entry]); // applyEntry runs the engine build → budget/placement enforced here; build self-closes → snapshot + turnRollover
        // A build closing the round clears any open attack chain (legalActions offers build mid-chain, so a human
        // can build to end an attack round) — a stale chainAttacker would let this seat later endRound at
        // round-start to skip a turn (DER #5). commitEntries' {...s} spread carries the OLD chainAttacker; clear it.
        return { next: { ...result.next, chainAttacker: result.advanced ? null : s.chainAttacker }, effects: result.effects };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = buildEngineErrorCode(message);
        if (code === null) throw err; // unrecognized engine throw = reducer/engine bug, stay loud (A3.2 rethrow policy)
        return keep(errorEffects(s, code, message));
      }
    }
    case "pass": {
      // Check 1: pass is legal only when config.allowPass OR the player is forced-pass (no other legal action).
      const passError = validatePass(s.game);
      if (passError !== null) {
        return keep(errorEffects(s, passError.code as WireErrorCode, passError.message)); // PASS_NOT_FORCED
      }
      // No try/catch: setup passes are envelope-rejected (SETUP_PLACEMENT_REQUIRED above), and a validated
      // PLAY-phase pass has no reachable rule throw — applyAction(pass) is a no-op, applyEliminations and
      // removeEncircledStrandedBases never throw (they may legitimately fire, e.g. a noIron elimination on the
      // first play-phase entry), and advanceRound only throws in setup (a victory-closing round skips it).
      // Any throw here is a reducer/engine bug and propagates loud (A3.2 policy).
      const entry: LogEntry = { player: ctx.actingSeat, kind: "pass", rngBeforeApply: s.game.rngState };
      const result = commitEntries(s, [entry]); // pass self-closes the round → snapshot + turnRollover
      // A pass closing the round clears any open attack chain (same DER #5 stale-token concern as build).
      return { next: { ...result.next, chainAttacker: result.advanced ? null : s.chainAttacker }, effects: result.effects };
    }
    case "attack": {
      // Attacker validation MUST precede acquiring the write-lock: opening a pending with an invalid attacker
      // set would wedge the room (the deferred apply throws forever). Order per the plan.
      const targetBase = s.game.bases.find((b) => key(b.hex) === key(c.decl.target));
      if (targetBase === undefined) {
        return keep(errorEffects(s, "MALFORMED", "No base exists at the attack target."));
      }
      const defenderOwner = targetBase.owner;
      const attackersError = validateAttackers(s.game, ctx.actingSeat, c.decl.target, c.decl.attackers);
      if (attackersError !== null) {
        return keep(errorEffects(s, attackersError.code as WireErrorCode, attackersError.message));
      }
      const attackableError = validateTargetAttackable(s.game, c.decl.target, defenderOwner);
      if (attackableError !== null) {
        return keep(errorEffects(s, attackableError.code as WireErrorCode, attackableError.message)); // NO_ELIGIBLE_DEFENDER
      }
      // Human defender: open a durable pending decision (acquires the write-lock; no log entry until resolved).
      if (s.seats[defenderOwner]!.config.kind === "human") {
        const { pending, effects } = openDefenderDecision(s, c.decl, defenderOwner, ctx);
        return { next: { ...s, pending }, effects };
      }
      // Agent/auto defender: substitute the deterministic representative defender and apply immediately.
      // (validateTargetAttackable already guaranteed representativeDefender is non-null.)
      const defender = representativeDefender(s.game, c.decl.target, defenderOwner)!;
      const finalDecl: AttackDecl = { ...c.decl, defender };
      const declError = validateAttackDecl(s.game, defenderOwner, finalDecl);
      if (declError !== null) {
        return keep(errorEffects(s, declError.code as WireErrorCode, declError.message));
      }
      const entry: LogEntry = { player: ctx.actingSeat, kind: "attack", decl: finalDecl, rngBeforeApply: s.game.rngState };
      const result = commitAttackRound(s, entry); // ONE atomic put: attack log:N (+ auto-close endRound + snapshot)
      return { next: withChainAttacker(result, ctx.actingSeat), effects: result.effects };
    }
    case "endRound": {
      // endRound is legal ONLY to close YOUR open attack chain (chainAttacker === actingSeat). This stops a
      // round-start endRound from illegally skipping a turn (voluntary pass is illegal, DER #5). The seat is
      // already the currentActor (envelope guard), so chainAttacker === actingSeat implies it is the actor's turn.
      if (s.chainAttacker !== ctx.actingSeat) {
        return keep(errorEffects(s, "NOT_YOUR_TURN", "endRound is only legal to close your own open attack chain."));
      }
      const entry: LogEntry = { player: ctx.actingSeat, kind: "endRound", rngBeforeApply: s.game.rngState };
      const result = commitEntries(s, [entry]); // closes the round → snapshot + turnRollover/gameOver
      return { next: withChainAttacker(result, ctx.actingSeat), effects: result.effects };
    }
    case "resolveDecision": {
      // A resolveDecision reaches the switch either authorized by the write-lock carve-out (pending present,
      // matching id, prompted seat, fresh index) OR — when no pending exists — through the envelope's else
      // branch. Guard the no-pending case (a ghost/late-retry id) as ALREADY_RESOLVED rather than dereferencing
      // a null pending; the carve-out already covers the wrong-id/wrong-seat cases when a pending IS present.
      if (s.pending === null) return keep(errorEffects(s, "ALREADY_RESOLVED", "That decision is no longer pending."));
      const result = resolveDefender(s, s.pending, c.defender);
      if ("error" in result) {
        // The pending STAYS so the prompted defender can retry with a valid choice.
        return keep(errorEffects(s, result.error.code as WireErrorCode, result.error.message));
      }
      return { next: withChainAttacker(result, s.pending.declaringPlayer), effects: result.effects };
    }
    case "extendDecision": {
      // Non-mutating (bypasses the envelope guards). A wrong id means the decision was already resolved →
      // ALREADY_RESOLVED; a wrong seat → NOT_YOUR_TURN. Seat auth is validated HERE and AGAIN inside
      // extendDefender (defense in depth per plan Task A4.3) — both layers must agree before the clock re-arms.
      // No agent-seat kind check here (deliberate, unlike the mutating-command backstop above and the pending
      // carve-out's kind check): extendDecision only re-arms an alarm/deadline, it never appends a log entry or
      // changes game state — there is no state-changing action for a kind check to guard. Its own promptedSeat
      // auth (below, and again inside extendDefender) is already the correct control for this non-mutating path.
      if (s.pending === null || c.decisionId !== s.pending.decisionId) {
        return keep(errorEffects(s, "ALREADY_RESOLVED", "That decision is no longer pending."));
      }
      if (ctx.actingSeat !== s.pending.promptedSeat) {
        return keep(errorEffects(s, "NOT_YOUR_TURN", "Only the prompted defender may extend their decision."));
      }
      const result = extendDefender(s, s.pending, ctx);
      if ("error" in result) {
        return keep(errorEffects(s, result.error.code as WireErrorCode, result.error.message));
      }
      return result;
    }
    case "claimSeat": {
      // Non-mutating (bypasses the envelope guards): a roster ack, not a game action — legal even while a
      // decision is pending. All CAS/idempotency/own-seat logic lives in seats.ts (A5.1).
      return claimSeat(s, c, ctx);
    }
    default: return keep(errorEffects(s, "UNKNOWN_TYPE", `Unknown command ${(c as { type?: string }).type}`));
  }
}

/** Set `next.chainAttacker` after a round-applying result: the attacker when a legal attack remains (chain
 *  continues, the round stayed open), else `null` when the round closed (commitEntries returned `advanced`).
 *  commitEntries' `{...s}` spread carries the OLD chainAttacker, so every attack/endRound path MUST set it here. */
function withChainAttacker(result: { next: SessionState; advanced: boolean }, attacker: PlayerId): SessionState {
  return { ...result.next, chainAttacker: result.advanced ? null : attacker };
}

/** Full-state resync payload (spec §3). A3 introduces the LOCKED SIGNATURE; A6 fills the seat-filtered pending
 *  projection. The roster comes from seats.ts's seatRoster (Phase A5). */
export function resyncPayload(s: SessionState, requestingSeat: number, reason: string | null): ServerMessage {
  return {
    type: "resync",
    snapshot: encodeState(s.game),
    logLength: s.logLength,
    pending: null, // A3 creates no pending; A6 adds the seat-filtered projection
    seats: seatRoster(s),
    protocolVersion: PROTOCOL_VERSION,
    replayVersion: s.header.replayVersion,
    reason,
  };
}
