// ABOUTME: The authoritative-state kernel every composer and HUD panel reads from — folds the
// ABOUTME: driver's event stream into a Zustand store: sync replaces state, applied folds via applyEntry.
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import { applyEntry } from "../engine-client/barrel";
import type { GameState } from "../engine-client/barrel";
import type { ConnectionStatus, DriverCommand, DriverEvent, DriverPending, GameDriver, SeatRosterEntry } from "./driver";

/** The ceremony data `turnRollover` carries. It is NOT the source of truth for game state —
 *  `state.phase.order` (set by `advanceRound` inside `applyEntry`, folded on the round-closing
 *  `applied` entry) is authoritative. This slice exists only so the turn-order ceremony UI (P3.7)
 *  has the `ironWeights` the reducer computed for the roll, which no `GameState` field carries. */
export type TurnRollover = { order: number[]; ironWeights: number[] | null };

export type GameOverTerminal = { winners: number[]; cause: string };

export type AuthoritativeSlice = {
  state: GameState | null;
  logLength: number;
  roster: SeatRosterEntry[];
  pending: DriverPending | null;
  connection: ConnectionStatus;
  turnRollover: TurnRollover | null;
  terminal: GameOverTerminal | null;
};

export type PreviewSlice = {
  state: GameState | null;
  source: DriverCommand | null;
};

export type UiSlice = {
  openComposer: string | null;
  selection: unknown | null;
  hover: unknown | null;
};

export type GameStoreState = {
  authoritative: AuthoritativeSlice;
  preview: PreviewSlice;
  ui: UiSlice;
  /** Subscribes to `driver`'s authoritative event stream and dispatches every event into the
   *  store. Returns the driver's unsubscribe function — callers (GameScreen, P3.11) tear down
   *  the wiring the same way they'd tear down any other subscription. */
  connectDriver: (driver: GameDriver) => () => void;
  /** Records the command an optimistic preview is FOR. The preview's derived `state` is P3.3's
   *  job — this slice only stores the source command; the state stays null until P3.3 fills it. */
  setPreview: (cmd: DriverCommand) => void;
  clearPreview: () => void;
};

const initialAuthoritative: AuthoritativeSlice = {
  state: null,
  logLength: 0,
  roster: [],
  pending: null,
  connection: "connecting",
  turnRollover: null,
  terminal: null,
};

const initialPreview: PreviewSlice = { state: null, source: null };

const initialUi: UiSlice = { openComposer: null, selection: null, hover: null };

/**
 * Builds a fresh, headless Zustand store instance (no React dependency — `getState`/`setState`/
 * `subscribe` work directly, which is what makes this testable without rendering anything).
 * Components consume the SAME instance through `zustand/react`'s `useStore(store, selector)` —
 * see `useGameStore` below — so there is exactly one store shape serving both call styles.
 */
export function createGameStore() {
  return createStore<GameStoreState>((set, get) => ({
    authoritative: initialAuthoritative,
    preview: initialPreview,
    ui: initialUi,

    connectDriver(driver: GameDriver): () => void {
      return driver.subscribe((event: DriverEvent) => {
        dispatch(event, driver, set, get);
      });
    },

    setPreview(cmd: DriverCommand): void {
      set({ preview: { state: null, source: cmd } });
    },

    clearPreview(): void {
      set({ preview: initialPreview });
    },
  }));
}

function dispatch(
  event: DriverEvent,
  driver: GameDriver,
  set: (partial: Partial<GameStoreState>) => void,
  get: () => GameStoreState,
): void {
  switch (event.type) {
    case "sync": {
      set({
        authoritative: {
          ...get().authoritative,
          state: event.snapshot,
          logLength: event.logLength,
          roster: event.seats,
          pending: event.pending,
        },
        preview: initialPreview,
      });
      return;
    }

    case "applied": {
      const authoritative = get().authoritative;
      if (event.logIndex !== authoritative.logLength) {
        // Duplicate (behind) or out-of-order (ahead) — do NOT fold. The stream has drifted from
        // what this client expects; force a fresh sync rather than applying against a state the
        // entry wasn't produced against.
        driver.requestSync();
        return;
      }
      if (authoritative.state === null) {
        // No baseline to fold onto yet (an `applied` arrived before the first `sync`) — resync.
        driver.requestSync();
        return;
      }
      const result = applyEntry(authoritative.state, event.entry);
      set({
        authoritative: {
          ...authoritative,
          state: result.state,
          logLength: authoritative.logLength + 1,
        },
        preview: initialPreview,
      });
      return;
    }

    case "turnRollover": {
      set({
        authoritative: {
          ...get().authoritative,
          turnRollover: { order: event.order, ironWeights: event.ironWeights },
        },
        preview: initialPreview,
      });
      return;
    }

    case "prompt": {
      const controllable = driver.controllableSeats().includes(event.pending.promptedSeat);
      if (!controllable) {
        // Another seat's decision — the client shows a waiting state, not the prompt itself.
        // Still an authoritative event: the preview clears even though `pending` doesn't change.
        set({ preview: initialPreview });
        return;
      }
      set({
        authoritative: { ...get().authoritative, pending: event.pending },
        preview: initialPreview,
      });
      return;
    }

    case "gameOver": {
      set({
        authoritative: {
          ...get().authoritative,
          terminal: { winners: event.winners, cause: event.cause },
        },
        preview: initialPreview,
      });
      return;
    }

    case "rejected": {
      if (event.code === "STALE_INDEX") {
        driver.requestSync();
      }
      set({ preview: initialPreview });
      return;
    }

    case "connection": {
      set({
        authoritative: { ...get().authoritative, connection: event.status },
        preview: initialPreview,
      });
      return;
    }
  }
}

/**
 * React-hook consumption of a `createGameStore()` instance — components call
 * `useGameStore(store, (s) => s.authoritative.state)` to subscribe to just the slice they read,
 * same as any other Zustand store. Tests never need this; they drive `store.getState()`/
 * `store.subscribe()` directly against the headless instance `createGameStore()` returns.
 */
export const useGameStore = useStore;
