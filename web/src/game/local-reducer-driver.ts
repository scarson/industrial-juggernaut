// ABOUTME: LocalReducerDriver — a GameDriver that drives the REAL session reducer in-browser (hotseat +
// ABOUTME: offline-vs-agents), mirroring the DO host's apply-then-drive loop with no DO/network/storage.
//
// DYNAMIC-IMPORT CONTRACT. This module value-imports `agentForSeat` (src/session/agent-binding), which is the
// ONE module that value-imports `src/agent`. It MUST therefore be reached ONLY via `import("./local-reducer-driver")`
// (never a static import from the entry graph) so Rollup keeps it — and agent-binding + src/agent — in its OWN lazy
// chunk, NOT the entry chunk. The GameScreen (P3.11) awaits `import("./local-reducer-driver")` and calls the factory.
// The build-time guard (web/scripts/check-bundle.ts) fails the build if any src/agent module lands in an eager chunk.
//
// WHAT IT DOES. `submit(cmd)` runs the host's two-part step: (1) `applyCommand(state, clientCommand, ctx)` handles the
// ONE human command and returns { next, effects }; (2) then, while `needsDrive(next)`, `driveOneStep(next, agentForSeat,
// ids)` advances agent/setup/eliminated seats — exactly the loop the DO host runs after a human command (see
// src/session/agent-drive.ts and the standalone drive in test/session/part-a-integration.test.ts). Each step's
// `effects` are translated to DriverEvents in order. `persist`/`alarm` are ignored (no storage/timeout locally;
// the defender timeout is OFF — DEFAULT_ROOM_OPTIONS with enabled:false).
import { openSession, applyCommand } from "../../../src/session/session";
import { needsDrive, driveOneStep, currentActor } from "../../../src/session/agent-drive";
import { agentForSeat } from "../../../src/session/agent-binding";
import { eligibleDefenders, toWirePending } from "../../../src/session/pending";
import { decodeEntry } from "../engine-client/barrel";
import type { SessionHeader } from "../engine-client/barrel";
import type { SessionState, CommandCtx, Effects } from "../../../src/session/session-types";
import type { ClientCommand, RoomOptions, ServerMessage, EncodedPending, WireErrorCode } from "../../../src/wire/protocol";
import type { DriverCommand, DriverEvent, DriverErrorCode, DriverPending, GameDriver, SeatRosterEntry } from "./driver";

/** Defender timeout is OFF locally — there is no host alarm/wall-clock to enforce a deadline (plan
 *  "Architectural decisions" #4; matches DEFAULT_ROOM_OPTIONS.defenderTimeout.enabled === false). */
const LOCAL_ROOM_OPTIONS: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };

/**
 * Total `WireErrorCode → DriverErrorCode` map (exhaustive `Record` so a future wire code fails typecheck here).
 *
 * `rejected` carries BOTH `code` and `message`; the driver passes the reducer's OWN error `message` through
 * verbatim (see `submit`), so the honest rule text always reaches the UI regardless of the code bucket. `code` is
 * used only for programmatic branching (the store special-cases `STALE_INDEX`) and `explainError`'s one-liner.
 *
 * Codes with a real `DriverErrorCode` counterpart map 1:1. The ORPHANS (no counterpart in the client-owned 20-code
 * union) fall into two groups, mapped conservatively:
 *  - Reachable-locally-on-an-illegal-command: `SETUP_PLACEMENT_REQUIRED` → `NOT_IN_SETUP` (both are setup-phase
 *    placement-ordering conditions); the six `BUILD_*` engine violations → `INVALID_ATTACKERS` is WRONG, so they map
 *    to `FROZEN` as the generic "command refused, not a teachable rule the client renders" bucket — these only fire
 *    when a composer gate is bypassed (BuildComposer already disables over-budget/illegal builds), so they are
 *    defense-in-depth, and their real rule text still reaches the user via `rejected.message`.
 *  - Transport/protocol-only (UNREACHABLE from a locally-mapped ClientCommand — the driver never sends hello/claimSeat,
 *    always stamps a fresh expectedLogIndex, always a known type): `MALFORMED`/`UNKNOWN_TYPE`/`OVERSIZED`/
 *    `ROOM_NOT_INITIALIZED`/`VERSION_MISMATCH`/`BAD_SEAT_TOKEN` → `FROZEN` (generic refusal).
 *
 * P4.1 revisits: the client-owned DriverErrorCode union may widen for honest build-error teaching, at which point
 * the total map is authored once with socket context and shared. Landing it here is P3.10's first need for it.
 */
const WIRE_TO_DRIVER_ERROR: Record<WireErrorCode, DriverErrorCode> = {
  // 1:1 — real counterparts
  STALE_INDEX: "STALE_INDEX",
  DECISION_PENDING: "DECISION_PENDING",
  ALREADY_RESOLVED: "ALREADY_RESOLVED",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  SEAT_TAKEN: "SEAT_TAKEN",
  GAME_OVER: "GAME_OVER",
  FROZEN: "FROZEN",
  NOT_IN_SETUP: "NOT_IN_SETUP",
  HEX_OFF_BOARD: "HEX_OFF_BOARD",
  HEX_NOT_OUTER: "HEX_NOT_OUTER",
  HEX_OCCUPIED: "HEX_OCCUPIED",
  INVALID_ATTACKERS: "INVALID_ATTACKERS",
  PASS_NOT_FORCED: "PASS_NOT_FORCED",
  ATTACK_NOT_SINGLE_DECL: "ATTACK_NOT_SINGLE_DECL",
  DUP_ATTACKERS: "DUP_ATTACKERS",
  DEFENDER_IS_TARGET: "DEFENDER_IS_TARGET",
  DEFENDER_INELIGIBLE: "DEFENDER_INELIGIBLE",
  NO_ELIGIBLE_DEFENDER: "NO_ELIGIBLE_DEFENDER",
  MIXED_PIECE_TYPES: "MIXED_PIECE_TYPES",
  DUP_PIECES: "DUP_PIECES",
  // ORPHAN (reachable-locally): setup-ordering + engine build violations. See doc comment above.
  SETUP_PLACEMENT_REQUIRED: "NOT_IN_SETUP",
  BUILD_EMPTY: "FROZEN",
  BUILD_BOOTSTRAP_FACTORY_ONLY: "FROZEN",
  BUILD_OVER_BUDGET: "FROZEN",
  BUILD_ILLEGAL_FACTORY: "FROZEN",
  BUILD_NO_BASES_IN_HAND: "FROZEN",
  BUILD_ILLEGAL_BASE: "FROZEN",
  // ORPHAN (transport/protocol-only, unreachable locally). See doc comment above.
  MALFORMED: "FROZEN",
  UNKNOWN_TYPE: "FROZEN",
  OVERSIZED: "FROZEN",
  ROOM_NOT_INITIALIZED: "FROZEN",
  VERSION_MISMATCH: "FROZEN",
  BAD_SEAT_TOKEN: "FROZEN",
};

/** Project the wire `EncodedPending` to the domain-shaped `DriverPending` (drops `kind`; fields otherwise align). */
function toDriverPending(p: EncodedPending): DriverPending {
  return {
    decisionId: p.decisionId,
    round: p.round,
    declaringPlayer: p.declaringPlayer,
    promptedSeat: p.promptedSeat,
    target: p.target,
    eligibleDefenders: p.eligibleDefenders,
    deadlineEpochMs: p.deadlineEpochMs,
  };
}

/** The seat roster the `sync` event reports — derived from the live SessionState's seat runtimes. */
function rosterOf(state: SessionState): SeatRosterEntry[] {
  return state.seats.map((r) => ({ seat: r.seat, claimed: r.claimed, kind: r.config.kind }));
}

export type LocalReducerDriverOptions = {
  /** Injected wall clock for `ctx.nowEpochMs` (the reducer is pure — no `Date.now()` inside it). Defaults to
   *  `Date.now`. Deadlines are OFF locally, but `openDefenderDecision` still stamps `nowEpochMs` into the ctx. */
  now?: () => number;
  /** Injected decisionId source for any pending a command/drive step opens. Defaults to `crypto.randomUUID()`
   *  (browser). Tests inject a deterministic counter so decisionIds are stable. */
  nextDecisionId?: () => string;
};

/**
 * Build a `GameDriver` that drives the real session reducer in-browser. The factory is the dynamic-import target
 * (see the DYNAMIC-IMPORT CONTRACT at the top of this file) — the value-import of `agentForSeat` it triggers pulls
 * `src/agent` into this module's lazy chunk.
 */
export function makeLocalReducerDriver(header: SessionHeader, opts: LocalReducerDriverOptions = {}): GameDriver {
  const now = opts.now ?? Date.now;
  const nextDecisionId = opts.nextDecisionId ?? (() => crypto.randomUUID());

  let state: SessionState = openSession(header, LOCAL_ROOM_OPTIONS);
  const handlers = new Set<(e: DriverEvent) => void>();
  let disposed = false;

  function emit(event: DriverEvent): void {
    for (const handler of handlers) handler(event);
  }

  function syncEvent(): DriverEvent {
    // The pending is surfaced with its canonical wire projection (eligibleDefenders derived by the reducer's own
    // pending.ts — never re-derived here, per GEO-5). Locally there is no seat filtering (hotseat shares the
    // screen), so a sync always carries an open pending.
    const pending = state.pending === null
      ? null
      : toDriverPending(toWirePending(state.pending, eligibleDefenders(state.game, state.pending.proposed.target, state.pending.promptedSeat)));
    return {
      type: "sync",
      snapshot: state.game, // the live decoded GameState the store folds `applied` entries onto
      logLength: state.logLength,
      pending,
      seats: rosterOf(state),
    };
  }

  /** Translate ONE ServerMessage (from a broadcast / toSeat / reply) into a DriverEvent, or null to drop it. */
  function toDriverEvent(msg: ServerMessage): DriverEvent | null {
    switch (msg.type) {
      case "applied":
        return { type: "applied", entry: decodeEntry(msg.entry), events: msg.events, logIndex: msg.logIndex };
      case "turnRollover":
        return { type: "turnRollover", order: msg.order, ironWeights: msg.ironWeights };
      case "gameOver":
        return { type: "gameOver", winners: msg.winners, cause: msg.cause };
      case "prompt":
        return { type: "prompt", pending: toDriverPending(msg.pending) };
      case "error":
        // Pass the reducer's own message through verbatim (Option A: the honest rule text reaches the UI via
        // `message`; `code` is only for programmatic branching + explainError's one-liner).
        return { type: "rejected", code: WIRE_TO_DRIVER_ERROR[msg.code], message: msg.message, currentLogIndex: msg.currentLogIndex };
      case "resync":
        // A STALE_INDEX resync reply — the local driver always stamps a fresh index so this is not expected, but
        // handle it defensively by re-emitting a fresh sync from the (unchanged) state.
        return syncEvent();
      case "reload":
        return { type: "connection", status: "reload-required" };
      case "seatClaimed":
        // No seat-claim flow locally (all seats are pre-owned); nothing to surface.
        return null;
    }
  }

  /** Emit the DriverEvents for one reducer result's Effects, in the DO host's own sink order —
   *  reply, then toSeat, then broadcast (game-room.ts's sendEffects). Every reducer Effects bundle
   *  populates at most one of these channels today, so the order is inert now; matching the host
   *  keeps it inert if a future reducer path ever combines channels. */
  function emitEffects(effects: Effects): void {
    for (const msg of effects.reply) { const e = toDriverEvent(msg); if (e) emit(e); }
    for (const t of effects.toSeat) { const e = toDriverEvent(t.message); if (e) emit(e); }
    for (const msg of effects.broadcast) { const e = toDriverEvent(msg); if (e) emit(e); }
  }

  /** After a human command, advance every agent/setup/eliminated seat until a human seat / pending / game end,
   *  emitting each step's effects — the DO host's post-command drive loop (agent-drive.ts). Threads `state`. */
  function driveAgents(): void {
    while (needsDrive(state)) {
      const r = driveOneStep(state, agentForSeat, { nowEpochMs: now(), decisionId: nextDecisionId() });
      state = r.next;
      emitEffects(r.effects);
    }
  }

  // Drive any agent/agent-first OPENING before the first subscriber — mirrors the DO host's init
  // (src/host/game-room.ts POST /init: openSession → driveAgents). Without this, an agent-first roster deadlocks:
  // the opening agent placement never runs, so the current actor stays the un-driven agent and the human's setup
  // command is NOT_YOUR_TURN forever. There are no handlers yet, so this drive's per-entry events are not delivered
  // (emit no-ops) — a fresh subscriber instead gets the post-opening state via its initial `sync`, exactly as a
  // late-joining client resyncs to current host state.
  driveAgents();

  /** Map a DriverCommand to the wire ClientCommand, stamping `expectedLogIndex` from the tracked logLength and
   *  carrying `decisionId` for resolve/extend. Returns the command plus the acting seat for the ctx. */
  function toClientCommand(cmd: DriverCommand): { command: ClientCommand; actingSeat: number } {
    const idx = state.logLength;
    switch (cmd.type) {
      case "placeFirstBase":
        return { command: { type: "placeFirstBase", expectedLogIndex: idx, hex: cmd.hex }, actingSeat: currentActor(state) };
      case "build":
        return { command: { type: "build", expectedLogIndex: idx, pieces: cmd.pieces }, actingSeat: currentActor(state) };
      case "attack":
        return { command: { type: "attack", expectedLogIndex: idx, decl: cmd.decl }, actingSeat: currentActor(state) };
      case "endRound":
        return { command: { type: "endRound", expectedLogIndex: idx }, actingSeat: currentActor(state) };
      case "pass":
        return { command: { type: "pass", expectedLogIndex: idx }, actingSeat: currentActor(state) };
      case "resolveDecision":
        // The acting seat is the PROMPTED DEFENDER, not currentActor (which is still the attacker during a pending).
        return {
          command: { type: "resolveDecision", expectedLogIndex: idx, decisionId: cmd.decisionId, defender: cmd.defender },
          actingSeat: state.pending?.promptedSeat ?? currentActor(state),
        };
      case "extendDecision":
        return {
          command: { type: "extendDecision", decisionId: cmd.decisionId },
          actingSeat: state.pending?.promptedSeat ?? currentActor(state),
        };
    }
  }

  return {
    subscribe(handler: (e: DriverEvent) => void): () => void {
      if (disposed) return () => {}; // a subscribe after dispose registers nothing and delivers nothing
      handlers.add(handler);
      handler(syncEvent()); // a new subscriber gets the current authoritative state immediately
      return () => { handlers.delete(handler); };
    },

    async submit(cmd: DriverCommand): Promise<void> {
      if (disposed) return;
      const { command, actingSeat } = toClientCommand(cmd);
      const ctx: CommandCtx = { actingSeat, nowEpochMs: now(), decisionId: nextDecisionId() };
      // (1) The ONE human command.
      const { next, effects } = applyCommand(state, command, ctx);
      state = next;
      emitEffects(effects);
      // (2) The host's post-command agent-drive loop — advances agent/setup/eliminated seats until a human/pending/end.
      driveAgents();
    },

    requestSync(): void {
      if (disposed) return;
      emit(syncEvent());
    },

    controllableSeats(): number[] {
      // Hotseat: every HUMAN seat shares the screen; agent seats are host(driver)-driven.
      return state.seats.filter((r) => r.config.kind === "human").map((r) => r.seat);
    },

    dispose(): void {
      disposed = true;
      handlers.clear();
    },
  };
}
