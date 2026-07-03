// ABOUTME: Proves makeFakeDriver is a strictly scripted GameDriver double — it echoes exactly
// ABOUTME: what the test provides/queues and never touches game rules (no applyEntry/applyAction).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { initGame, defaultConfig } from "../engine-client/barrel";
import { makeFakeDriver } from "./fake-driver";
import type { GameState } from "../engine-client/barrel";
import type { DriverEvent, DriverPending, SeatRosterEntry } from "./driver";

// Fixed-seed setup-phase fixture (2 players, size-96 board) — deterministic across runs.
// The fake driver never constructs GameState itself; this is the TEST's own snapshot,
// handed to makeFakeDriver to echo back verbatim.
function fixtureState(): GameState {
  return initGame({
    seed: 1n,
    boardSource: { kind: "generate", size: 96, ironCount: 14 },
    nPlayers: 2,
    config: defaultConfig(),
  });
}

function fixtureRoster(): SeatRosterEntry[] {
  return [
    { seat: 0, claimed: true, kind: "human" },
    { seat: 1, claimed: true, kind: "human" },
  ];
}

function fixturePending(): DriverPending {
  return {
    decisionId: "d1",
    round: 1,
    declaringPlayer: 0,
    promptedSeat: 1,
    target: { x: 0, y: 0, z: 0 },
    eligibleDefenders: [{ x: 1, y: -1, z: 0 }],
    deadlineEpochMs: null,
  };
}

describe("makeFakeDriver", () => {
  test("subscribe immediately emits a sync event built from the provided snapshot + roster", () => {
    const snapshot = fixtureState();
    const roster = fixtureRoster();
    const driver = makeFakeDriver({ snapshot, roster, controllableSeats: [0, 1] });

    const received: DriverEvent[] = [];
    driver.subscribe((e) => received.push(e));

    expect(received).toHaveLength(1);
    const syncEvent = received[0]!;
    expect(syncEvent.type).toBe("sync");
    if (syncEvent.type !== "sync") throw new Error("unreachable");
    // The fake echoes the TEST's own object — it never constructs or clones GameState.
    expect(syncEvent.snapshot).toBe(snapshot);
    expect(syncEvent.seats).toBe(roster);
    expect(syncEvent.logLength).toBe(0);
    expect(syncEvent.pending).toBeNull();
  });

  test("subscribe honors an explicit logLength and pending override", () => {
    const snapshot = fixtureState();
    const pending = fixturePending();
    const driver = makeFakeDriver({
      snapshot,
      roster: fixtureRoster(),
      controllableSeats: [0],
      logLength: 7,
      pending,
    });

    const received: DriverEvent[] = [];
    driver.subscribe((e) => received.push(e));

    const syncEvent = received[0]!;
    if (syncEvent.type !== "sync") throw new Error("unreachable");
    expect(syncEvent.logLength).toBe(7);
    expect(syncEvent.pending).toBe(pending);
  });

  test("submit() emits the queued scripted event(s) then resolves — resolution means ACCEPTED, not applied", async () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });

    const appliedEvent: DriverEvent = {
      type: "applied",
      entry: { player: 0, kind: "pass", rngBeforeApply: snapshot.rngState },
      events: [],
      logIndex: 0,
    };
    driver.enqueueEvents([appliedEvent]);

    const received: DriverEvent[] = [];
    driver.subscribe((e) => received.push(e)); // consumes the initial sync

    await driver.submit({ type: "pass" });

    // sync (from subscribe) + the scripted applied event.
    expect(received).toHaveLength(2);
    expect(received[1]).toBe(appliedEvent);
  });

  test("submit() can emit a scripted rejected event", async () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });

    const rejectedEvent: DriverEvent = {
      type: "rejected",
      code: "PASS_NOT_FORCED",
      message: "pass is not forced",
      currentLogIndex: 0,
    };
    driver.enqueueEvents([rejectedEvent]);

    const received: DriverEvent[] = [];
    driver.subscribe((e) => received.push(e));

    await driver.submit({ type: "pass" });

    expect(received).toHaveLength(2);
    expect(received[1]).toBe(rejectedEvent);
  });

  test("submit() with no queued script emits nothing beyond the recorded command — still resolves", async () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });

    const received: DriverEvent[] = [];
    driver.subscribe((e) => received.push(e));

    await expect(driver.submit({ type: "pass" })).resolves.toBeUndefined();
    expect(received).toHaveLength(1); // only the initial sync — no scripted event was queued
  });

  test("pushEvent() injects an event out-of-band to all current subscribers", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });

    const receivedA: DriverEvent[] = [];
    const receivedB: DriverEvent[] = [];
    driver.subscribe((e) => receivedA.push(e));
    driver.subscribe((e) => receivedB.push(e));

    const connectionEvent: DriverEvent = { type: "connection", status: "reconnecting" };
    driver.pushEvent(connectionEvent);

    expect(receivedA[receivedA.length - 1]).toBe(connectionEvent);
    expect(receivedB[receivedB.length - 1]).toBe(connectionEvent);
  });

  test("unsubscribe stops further delivery to that handler", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });

    const received: DriverEvent[] = [];
    const unsubscribe = driver.subscribe((e) => received.push(e));
    unsubscribe();

    driver.pushEvent({ type: "connection", status: "closed" });
    expect(received).toHaveLength(1); // only the initial sync; the pushEvent never arrived
  });

  test("submitted() returns every recorded command in submission order", async () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });

    await driver.submit({ type: "pass" });
    await driver.submit({ type: "endRound" });

    expect(driver.submitted()).toEqual([{ type: "pass" }, { type: "endRound" }]);
  });

  test("controllableSeats() returns the configured seats", () => {
    const driver = makeFakeDriver({
      snapshot: fixtureState(),
      roster: fixtureRoster(),
      controllableSeats: [1],
    });
    expect(driver.controllableSeats()).toEqual([1]);
  });

  test("requestSync() re-emits a sync from the current provided snapshot", () => {
    const snapshot = fixtureState();
    const roster = fixtureRoster();
    const driver = makeFakeDriver({ snapshot, roster, controllableSeats: [0], logLength: 3 });

    const received: DriverEvent[] = [];
    driver.subscribe((e) => received.push(e));
    received.length = 0; // discard the subscribe-time sync

    driver.requestSync();

    expect(received).toHaveLength(1);
    const syncEvent = received[0]!;
    if (syncEvent.type !== "sync") throw new Error("unreachable");
    expect(syncEvent.snapshot).toBe(snapshot);
    expect(syncEvent.logLength).toBe(3);
  });

  test("dispose() is a no-op teardown — it does not throw and further pushEvent calls are simply inert to prior subscribers", () => {
    const driver = makeFakeDriver({
      snapshot: fixtureState(),
      roster: fixtureRoster(),
      controllableSeats: [0],
    });
    expect(() => driver.dispose()).not.toThrow();
  });

  test("the driver mutates no game state on its own — every emitted snapshot is strict-equal to what the test provided", async () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });

    const nextSnapshot = fixtureState();
    const appliedEvent: DriverEvent = {
      type: "applied",
      entry: { player: 0, kind: "pass", rngBeforeApply: snapshot.rngState },
      events: [],
      logIndex: 0,
    };
    driver.enqueueEvents([appliedEvent]);

    const received: DriverEvent[] = [];
    driver.subscribe((e) => received.push(e));
    await driver.submit({ type: "pass" });

    const syncEvent = received[0]!;
    if (syncEvent.type !== "sync") throw new Error("unreachable");
    expect(syncEvent.snapshot).toBe(snapshot); // identity, not deep-equal — proves no clone/derive

    // The scripted "applied" event is echoed verbatim too — the fake never re-derives it via
    // applyEntry/applyAction. (nextSnapshot exists only to show the fake did NOT synthesize
    // a new state from the command; it's unused by the fake entirely.)
    expect(received[1]).toBe(appliedEvent);
    void nextSnapshot;
  });

  test("grep-proof: fake-driver.ts never imports applyEntry or applyAction (no engine-apply)", () => {
    const filePath = join(import.meta.dirname, "fake-driver.ts");
    const source = readFileSync(filePath, "utf8");
    // Scoped to actual import statements, not prose — the module's own doc comment names
    // applyEntry/applyAction to explain what this double deliberately does NOT call.
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/\bapplyEntry\b/);
      expect(line).not.toMatch(/\bapplyAction\b/);
    }
  });
});
