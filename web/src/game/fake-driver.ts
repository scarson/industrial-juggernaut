// ABOUTME: A strictly scripted GameDriver double — the boundary fake every P3 component and the
// ABOUTME: store test against. It runs NO game rules; it only stores + echoes what the test hands it.
//
// This is a BOUNDARY double, not a stand-in for real game logic (testing-pitfalls.md §7): the
// component or store under test owns the assertions about game rules, not this file. The fake
// never calls applyEntry/applyAction and never derives a GameState — every snapshot and event it
// emits is exactly the object a test provided or queued. Do NOT assert game-rule outcomes through
// this double; script the events the rules layer would have produced and assert on how the caller
// reacts to them.
import type { DriverCommand, DriverEvent, DriverPending, GameDriver, SeatRosterEntry } from "./driver";
import type { GameState } from "../engine-client/barrel";

export type FakeDriverOptions = {
  /** The state a `sync` event reports. The fake stores this reference and echoes it verbatim —
   *  it never clones or derives a GameState. */
  snapshot: GameState;
  /** The seat roster a `sync` event reports. */
  roster: SeatRosterEntry[];
  /** Seats `controllableSeats()` reports. */
  controllableSeats: number[];
  /** The log length a `sync` event reports. Defaults to 0. */
  logLength?: number;
  /** The pending defender decision a `sync` event reports. Defaults to null. */
  pending?: DriverPending | null;
};

/**
 * The scripted GameDriver double for P3 component/store tests.
 *
 * Scripting is queue-based: call `enqueueEvents(events)` to schedule the event(s) the NEXT
 * `submit()` call emits before resolving. Queue entries are consumed one-per-submit, in FIFO
 * order — a `submit()` with an empty queue emits nothing beyond recording the command. Tests
 * build scenarios incrementally (queue a `rejected`, submit, observe; then queue an `applied`,
 * submit again, observe) rather than pre-declaring a fixed script array up front, since P3
 * components typically drive one command at a time in response to simulated user action.
 *
 * `pushEvent(e)` is the separate out-of-band channel for events not tied to a submit — e.g. a
 * `turnRollover` or `connection` change the "server" decides to send unprompted.
 *
 * `submit()`'s returned Promise resolves synchronously (after emitting any queued events) since
 * this fake has no transport. That's a degenerate case of the real GameDriver contract, which
 * resolves on ACCEPTANCE (queued/sent), not on apply — a real driver (e.g. a socket-backed one)
 * resolves before the authoritative `applied`/`rejected` event arrives, typically over an async
 * round trip. Callers MUST NOT rely on submit's resolution ordering relative to events beyond
 * what the interface promises.
 */
export function makeFakeDriver(opts: FakeDriverOptions): GameDriver & {
  /** Queue the DriverEvent(s) the next `submit()` call emits, in order, before resolving. */
  enqueueEvents(events: DriverEvent[]): void;
  /** Inject an event out-of-band to every currently subscribed handler. */
  pushEvent(event: DriverEvent): void;
  /** Every DriverCommand passed to `submit()`, in submission order. */
  submitted(): DriverCommand[];
} {
  const handlers = new Set<(e: DriverEvent) => void>();
  const submittedCommands: DriverCommand[] = [];
  const eventQueue: DriverEvent[][] = [];

  const snapshot = opts.snapshot;
  const roster = opts.roster;
  const logLength = opts.logLength ?? 0;
  const pending = opts.pending ?? null;

  function syncEvent(): DriverEvent {
    return { type: "sync", snapshot, logLength, pending, seats: roster };
  }

  return {
    subscribe(handler) {
      handlers.add(handler);
      handler(syncEvent());
      return () => {
        handlers.delete(handler);
      };
    },

    async submit(cmd: DriverCommand): Promise<void> {
      submittedCommands.push(cmd);
      const scripted = eventQueue.shift();
      if (scripted) {
        for (const event of scripted) {
          for (const handler of handlers) handler(event);
        }
      }
    },

    requestSync(): void {
      const event = syncEvent();
      for (const handler of handlers) handler(event);
    },

    controllableSeats(): number[] {
      return opts.controllableSeats;
    },

    dispose(): void {
      // No transport, no timers, no subscriptions to tear down beyond what unsubscribe already
      // handles — teardown is intentionally inert.
    },

    enqueueEvents(events: DriverEvent[]): void {
      eventQueue.push(events);
    },

    pushEvent(event: DriverEvent): void {
      for (const handler of handlers) handler(event);
    },

    submitted(): DriverCommand[] {
      return submittedCommands;
    },
  };
}
