// ABOUTME: Proves the store folds the authoritative DriverEvent stream correctly — sync replaces
// ABOUTME: state wholesale, applied folds via applyEntry under a log-index continuity guard, and every
// ABOUTME: authoritative event clears the (advisory) preview slice. Driven entirely off the fake driver.
import { describe, expect, test } from "vitest";
import { applyEntry, initGame, defaultConfig, legalFirstBaseHexes } from "../engine-client/barrel";
import { makeFakeDriver } from "./fake-driver";
import { createGameStore } from "./store";
import type { GameState } from "../engine-client/barrel";
import type { LogEntry } from "../engine-client/barrel";
import type { DriverEvent, DriverPending, SeatRosterEntry } from "./driver";

// Fixed-seed setup-phase fixture (2 players, size-96 board) — deterministic across runs, mirrors
// fake-driver.test.ts's fixture so behavior is directly comparable.
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

function fixturePending(promptedSeat: number): DriverPending {
  return {
    decisionId: "d1",
    round: 1,
    declaringPlayer: 0,
    promptedSeat,
    target: { x: 0, y: 0, z: 0 },
    eligibleDefenders: [{ x: 1, y: -1, z: 0 }],
    deadlineEpochMs: null,
  };
}

describe("createGameStore", () => {
  test("has no authoritative state before connecting a driver", () => {
    const store = createGameStore();
    const state = store.getState();

    expect(state.authoritative.state).toBeNull();
    expect(state.authoritative.logLength).toBe(0);
    expect(state.authoritative.roster).toEqual([]);
    expect(state.authoritative.pending).toBeNull();
    expect(state.authoritative.connection).toBe("connecting");
    expect(state.preview.state).toBeNull();
    expect(state.preview.source).toBeNull();
  });

  test("connectDriver's initial sync sets authoritative state + logLength + roster + pending, clears preview", () => {
    const snapshot = fixtureState();
    const roster = fixtureRoster();
    const driver = makeFakeDriver({ snapshot, roster, controllableSeats: [0, 1], logLength: 5 });
    const store = createGameStore();

    // A stale preview from before the sync must be cleared by it.
    store.getState().setPreview({ type: "pass" });
    expect(store.getState().preview.source).not.toBeNull();

    store.getState().connectDriver(driver);

    const state = store.getState();
    expect(state.authoritative.state).toBe(snapshot); // identity — sync replaces wholesale, no clone
    expect(state.authoritative.logLength).toBe(5);
    expect(state.authoritative.roster).toBe(roster);
    expect(state.authoritative.pending).toBeNull();
    expect(state.preview.state).toBeNull();
    expect(state.preview.source).toBeNull();
  });

  test("a sync event received later (requestSync) replaces authoritative state wholesale", () => {
    const firstSnapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot: firstSnapshot, roster: fixtureRoster(), controllableSeats: [0] });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const secondSnapshot = fixtureState();
    driver.pushEvent({
      type: "sync",
      snapshot: secondSnapshot,
      logLength: 12,
      pending: null,
      seats: fixtureRoster(),
    });

    const state = store.getState();
    expect(state.authoritative.state).toBe(secondSnapshot);
    expect(state.authoritative.logLength).toBe(12);
  });

  test("applied with a continuous logIndex folds the entry via applyEntry — state advances to exactly applyEntry's output", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0], logLength: 0 });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const entry: LogEntry = {
      player: 0,
      kind: "placeFirstBase",
      hex: legalFirstBaseHexes(snapshot)[0]!,
      rngBeforeApply: snapshot.rngState,
    };
    const expected = applyEntry(snapshot, entry);

    driver.pushEvent({ type: "applied", entry, events: expected.events, logIndex: 0 });

    const state = store.getState();
    expect(state.authoritative.state).toEqual(expected.state); // deep structural equality, not stringified
    expect(state.authoritative.logLength).toBe(1);
    expect(state.preview.state).toBeNull();
    expect(state.preview.source).toBeNull();
  });

  test("applied clears an active preview even though the fold itself is unrelated to the preview", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0], logLength: 0 });
    const store = createGameStore();
    store.getState().connectDriver(driver);
    store.getState().setPreview({ type: "pass" });
    expect(store.getState().preview.source).not.toBeNull();

    const entry: LogEntry = {
      player: 0,
      kind: "placeFirstBase",
      hex: legalFirstBaseHexes(snapshot)[0]!,
      rngBeforeApply: snapshot.rngState,
    };
    driver.pushEvent({ type: "applied", entry, events: [], logIndex: 0 });

    expect(store.getState().preview.state).toBeNull();
    expect(store.getState().preview.source).toBeNull();
  });

  test("log-index guard: an applied whose logIndex is behind current logLength (duplicate) does NOT fold and triggers requestSync", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0], logLength: 3 });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const requestSyncCalls: number[] = [];
    const originalRequestSync = driver.requestSync.bind(driver);
    driver.requestSync = () => {
      requestSyncCalls.push(1);
      originalRequestSync();
    };

    const stateBefore = store.getState().authoritative.state;
    const entry: LogEntry = {
      player: 0,
      kind: "pass",
      rngBeforeApply: snapshot.rngState,
    };
    // logIndex 1 is stale — the store's authoritative.logLength is already 3.
    driver.pushEvent({ type: "applied", entry, events: [], logIndex: 1 });

    expect(store.getState().authoritative.state).toBe(stateBefore); // untouched — same reference
    expect(store.getState().authoritative.logLength).toBe(3); // untouched
    expect(requestSyncCalls).toHaveLength(1);
  });

  test("log-index guard: an applied whose logIndex is ahead of current logLength (out-of-order) does NOT fold and triggers requestSync", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0], logLength: 3 });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const requestSyncCalls: number[] = [];
    const originalRequestSync = driver.requestSync.bind(driver);
    driver.requestSync = () => {
      requestSyncCalls.push(1);
      originalRequestSync();
    };

    const stateBefore = store.getState().authoritative.state;
    const entry: LogEntry = {
      player: 0,
      kind: "pass",
      rngBeforeApply: snapshot.rngState,
    };
    // logIndex 5 is ahead — the store expects 3 next.
    driver.pushEvent({ type: "applied", entry, events: [], logIndex: 5 });

    expect(store.getState().authoritative.state).toBe(stateBefore); // untouched — same reference
    expect(store.getState().authoritative.logLength).toBe(3); // untouched
    expect(requestSyncCalls).toHaveLength(1);
  });

  test("turnRollover stores the ceremony's order + ironWeights without treating them as the source of truth for game state", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    driver.pushEvent({ type: "turnRollover", order: [1, 0], ironWeights: [3, 5] });

    const state = store.getState();
    expect(state.authoritative.turnRollover).toEqual({ order: [1, 0], ironWeights: [3, 5] });
    // The authoritative GameState reference is untouched by turnRollover alone — advanceRound (via
    // applyEntry, folded on the closing `applied`) is the source of truth for state.phase.order.
    expect(state.authoritative.state).toBe(snapshot);
  });

  test("prompt sets pending when the driver controls the promptedSeat", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0, 1] });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const pending = fixturePending(1);
    driver.pushEvent({ type: "prompt", pending });

    expect(store.getState().authoritative.pending).toBe(pending);
  });

  test("prompt does NOT set pending when the promptedSeat is not controllable — it's another seat's decision", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const pending = fixturePending(1); // seat 1 — not in controllableSeats [0]
    driver.pushEvent({ type: "prompt", pending });

    expect(store.getState().authoritative.pending).toBeNull();
  });

  test("a non-controllable prompt still clears the preview — it is an authoritative event even though pending doesn't change", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });
    const store = createGameStore();
    store.getState().connectDriver(driver);
    store.getState().setPreview({ type: "pass" });
    expect(store.getState().preview.source).not.toBeNull();

    driver.pushEvent({ type: "prompt", pending: fixturePending(1) });

    expect(store.getState().preview.state).toBeNull();
    expect(store.getState().preview.source).toBeNull();
  });

  test("gameOver sets terminal with winners + cause", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    driver.pushEvent({ type: "gameOver", winners: [0], cause: "victory" });

    expect(store.getState().authoritative.terminal).toEqual({ winners: [0], cause: "victory" });
  });

  test("rejected with STALE_INDEX triggers driver.requestSync()", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0], logLength: 4 });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const requestSyncCalls: number[] = [];
    const originalRequestSync = driver.requestSync.bind(driver);
    driver.requestSync = () => {
      requestSyncCalls.push(1);
      originalRequestSync();
    };

    driver.pushEvent({ type: "rejected", code: "STALE_INDEX", message: "stale", currentLogIndex: 4 });

    expect(requestSyncCalls).toHaveLength(1);
  });

  test("rejected with a non-STALE_INDEX code does NOT trigger requestSync", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0], logLength: 4 });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    const requestSyncCalls: number[] = [];
    const originalRequestSync = driver.requestSync.bind(driver);
    driver.requestSync = () => {
      requestSyncCalls.push(1);
      originalRequestSync();
    };

    driver.pushEvent({ type: "rejected", code: "PASS_NOT_FORCED", message: "not forced", currentLogIndex: 4 });

    expect(requestSyncCalls).toHaveLength(0);
  });

  test("connection updates authoritative.connection status", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0] });
    const store = createGameStore();
    store.getState().connectDriver(driver);

    driver.pushEvent({ type: "connection", status: "reconnecting" });

    expect(store.getState().authoritative.connection).toBe("reconnecting");
  });

  test("setPreview stores the driver command as the preview source", () => {
    const store = createGameStore();
    const cmd = { type: "pass" as const };

    store.getState().setPreview(cmd);

    expect(store.getState().preview.source).toBe(cmd);
  });

  test("clearPreview resets the preview slice to null/null", () => {
    const store = createGameStore();
    store.getState().setPreview({ type: "pass" });

    store.getState().clearPreview();

    expect(store.getState().preview.state).toBeNull();
    expect(store.getState().preview.source).toBeNull();
  });

  test("connectDriver returns the driver's unsubscribe function — calling it stops further dispatch", () => {
    const snapshot = fixtureState();
    const driver = makeFakeDriver({ snapshot, roster: fixtureRoster(), controllableSeats: [0], logLength: 0 });
    const store = createGameStore();

    const unsubscribe = store.getState().connectDriver(driver);
    unsubscribe();

    const connectionBefore = store.getState().authoritative.connection;
    driver.pushEvent({ type: "connection", status: "closed" });

    expect(store.getState().authoritative.connection).toBe(connectionBefore); // unchanged — no longer subscribed
  });
});
