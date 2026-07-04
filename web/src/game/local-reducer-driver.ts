// ABOUTME: LocalReducerDriver — a GameDriver that drives the REAL session reducer in-browser (hotseat +
// ABOUTME: offline-vs-agents), mirroring the DO host's apply-then-drive loop with no DO/network/storage.
//
// DYNAMIC-IMPORT CONTRACT. This module value-imports `agentForSeat` (src/session/agent-binding), which is the
// ONE module that value-imports `src/agent`, and `./wire-map`, which value-imports the src/wire codecs. It MUST
// therefore be reached ONLY via `import("./local-reducer-driver")` (never a static import from the entry graph) so
// Rollup keeps it — and agent-binding + src/agent + wire-map + src/wire — in its OWN lazy chunk, NOT the entry chunk.
// The GameScreen (P3.11) awaits `import("./local-reducer-driver")` and calls the factory. The build-time guard
// (web/scripts/check-bundle.ts) fails the build if any src/agent or src/wire module lands in an eager chunk.
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
import { toClientCommand, toDriverEvent as wireToDriverEvent, toDriverPending } from "./wire-map";
import type { SessionHeader } from "../engine-client/barrel";
import type { SessionState, CommandCtx, Effects } from "../../../src/session/session-types";
import type { RoomOptions, ServerMessage } from "../../../src/wire/protocol";
import type { DriverCommand, DriverEvent, GameDriver, SeatRosterEntry } from "./driver";

/** Defender timeout is OFF locally — there is no host alarm/wall-clock to enforce a deadline (plan
 *  "Architectural decisions" #4; matches DEFAULT_ROOM_OPTIONS.defenderTimeout.enabled === false). */
const LOCAL_ROOM_OPTIONS: RoomOptions = { defenderTimeout: { enabled: false, seconds: 120 } };

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

  /** Translate ONE ServerMessage (from a broadcast / toSeat / reply) into a DriverEvent, or null to drop it.
   *  Every message but `resync` maps through the shared wire-map seam. A local `resync` is re-emitted as a
   *  fresh sync from the (unchanged) LOCAL state: the local driver always stamps a fresh index so a
   *  STALE_INDEX resync is never expected, and there is no wire snapshot to decode — the live SessionState
   *  IS the source of truth, so `syncEvent()` reflects it directly (wire-map's resync path decodes a
   *  transported snapshot, which does not apply here). */
  function toDriverEvent(msg: ServerMessage): DriverEvent | null {
    if (msg.type === "resync") return syncEvent();
    return wireToDriverEvent(msg);
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

  /** Which seat the local ctx attributes a command to. A socket carries seat identity in its binding; locally
   *  there is none, so the driver derives it from state: for a decision resolve/extend it is the PROMPTED
   *  DEFENDER (currentActor is still the attacker during a pending), otherwise the current actor. */
  function actingSeatFor(cmd: DriverCommand): number {
    if (cmd.type === "resolveDecision" || cmd.type === "extendDecision") {
      return state.pending?.promptedSeat ?? currentActor(state);
    }
    return currentActor(state);
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
      const command = toClientCommand(cmd, state.logLength);
      const ctx: CommandCtx = { actingSeat: actingSeatFor(cmd), nowEpochMs: now(), decisionId: nextDecisionId() };
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
