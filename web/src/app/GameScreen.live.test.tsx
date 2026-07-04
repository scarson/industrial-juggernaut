// ABOUTME: The live-game path of GameScreen — the online entry (createRoom → SocketDriver) drives the SAME
// ABOUTME: store/composers as the fake-driver path, and the reload-guard fires on connection:"reload-required".
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameScreen } from "./GameScreen";
import { RailContentOutlet, RailContentProvider } from "./shell/rail-content";
import { makeFakeDriver } from "../game/fake-driver";
import { createGameStore } from "../game/store";
import { defaultConfig, initGame } from "../engine-client/barrel";
import type { CreateRoomRequest, CreateRoomResult } from "../game/rooms";
import type { OnlineConnection } from "./GameScreen";
import type { GameDriver, SeatRosterEntry } from "../game/driver";
import type { GameState } from "../engine-client/barrel";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────
function setupState(): GameState {
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
    { seat: 1, claimed: false, kind: "agent" },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Fill in the online designer form for a one-human-plus-agent roster and click the online action.
 * The NewGame designer defaults to two human seats, so switch seat 2 to an agent first (one human left).
 */
async function startOnline(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Seat 2 kind"), "heuristic");
  await user.click(screen.getByRole("button", { name: /play online/i }));
}

describe("GameScreen — online entry gating", () => {
  test("the online action is DISABLED with a note when the roster has more than one human seat", () => {
    // Default roster is two human seats — online play supports one human + agents only.
    render(
      <RailContentProvider>
        <GameScreen />
        <RailContentOutlet placeholder={<p>rail placeholder</p>} />
      </RailContentProvider>,
    );
    const online = screen.getByRole("button", { name: /play online/i });
    expect(online).toBeDisabled();
    expect(screen.getByText(/one human seat plus agents/i)).toBeInTheDocument();
  });

  test("the online action is ENABLED once the roster is exactly one human seat", async () => {
    const user = userEvent.setup();
    render(
      <RailContentProvider>
        <GameScreen />
        <RailContentOutlet placeholder={<p>rail placeholder</p>} />
      </RailContentProvider>,
    );
    await user.selectOptions(screen.getByLabelText("Seat 2 kind"), "heuristic");
    expect(screen.getByRole("button", { name: /play online/i })).toBeEnabled();
  });
});

describe("GameScreen — live path drives the same store/composers", () => {
  test("clicking online creates a room and mounts the SocketDriver-backed PlayView", async () => {
    const user = userEvent.setup();

    // Injected create-room: records the request, returns a room + a human-seat token (agent seat null).
    let seenRequest: CreateRoomRequest | null = null;
    const createRoomFn = async (req: CreateRoomRequest): Promise<CreateRoomResult> => {
      seenRequest = req;
      return { roomId: "room-live", seatTokens: ["tok-human", null] };
    };

    // Injected live driver: a fake driver over the resolved connection; records the connection it got.
    let seenConnection: OnlineConnection | null = null;
    const fakeDriver = makeFakeDriver({ snapshot: setupState(), roster: fixtureRoster(), controllableSeats: [0] });
    const createOnlineDriver = (conn: OnlineConnection): GameDriver => {
      seenConnection = conn;
      return fakeDriver;
    };

    render(
      <RailContentProvider>
        <GameScreen createRoomFn={createRoomFn} createOnlineDriver={createOnlineDriver} />
        <RailContentOutlet placeholder={<p>rail placeholder</p>} />
      </RailContentProvider>,
    );

    await startOnline(user);

    // The create-room body carried EXACTLY the designer config: one human + one agent seat, seed as a
    // decimal string, no version fields.
    await waitFor(() => expect(seenRequest).not.toBeNull());
    expect(seenRequest!.seats).toEqual([{ kind: "human" }, { kind: "agent", agent: "heuristic" }]);
    expect(typeof seenRequest!.seed).toBe("string");
    expect(seenRequest).not.toHaveProperty("formatVersion");
    expect(seenRequest).not.toHaveProperty("replayVersion");

    // The SocketDriver was constructed with the creator's human seat (index 0) + that seat's token.
    expect(seenConnection).toEqual({ roomId: "room-live", seat: 0, token: "tok-human" });

    // The live PlayView drives the SAME store/composers stack — the fake driver's sync is a setup state,
    // so the SetupPlacement composer mounts (the transport swap: nothing above the driver seam changed).
    expect(await screen.findByRole("region", { name: /setup placement/i })).toBeInTheDocument();
  });
});

describe("GameScreen — reload-guard on connection:reload-required", () => {
  /** Mount a live game with an injected store + fake driver, plus injected reloadFn + storage for the guard. */
  function renderLiveWithGuard(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, reloadFn: () => void) {
    const store = createGameStore();
    const fakeDriver = makeFakeDriver({ snapshot: setupState(), roster: fixtureRoster(), controllableSeats: [0] });
    const createRoomFn = async (): Promise<CreateRoomResult> => ({ roomId: "r", seatTokens: ["tok", null] });
    const createOnlineDriver = (): GameDriver => fakeDriver;
    render(
      <RailContentProvider>
        <GameScreen
          createRoomFn={createRoomFn}
          createOnlineDriver={createOnlineDriver}
          store={store}
          reloadFn={reloadFn}
          reloadStorage={storage}
        />
        <RailContentOutlet placeholder={<p>rail placeholder</p>} />
      </RailContentProvider>,
    );
    return fakeDriver;
  }

  function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
    const map = new Map<string, string>();
    return {
      getItem: (k) => (map.has(k) ? map.get(k)! : null),
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
  }

  const RELOAD_MARKER_KEY = "industrial-juggernaut:reload-guard:reloaded";

  test("the first reload-required signal calls reloadFn once (a hard reload)", async () => {
    const user = userEvent.setup();
    const reloadFn = vi.fn();
    const fakeDriver = renderLiveWithGuard(memoryStorage(), reloadFn);

    await startOnline(user);
    await screen.findByRole("region", { name: /setup placement/i });

    act(() => {
      fakeDriver.pushEvent({ type: "connection", status: "reload-required" });
    });

    await waitFor(() => expect(reloadFn).toHaveBeenCalledTimes(1));
  });

  test("when the marker is already set (loop), it renders the manual-refresh notice, no reload", async () => {
    const user = userEvent.setup();
    const reloadFn = vi.fn();
    // Pre-set the marker so handleReload returns "loop-detected" on the first signal this load.
    const storage = memoryStorage();
    storage.setItem("industrial-juggernaut:reload-guard:reloaded", "1");
    const fakeDriver = renderLiveWithGuard(storage, reloadFn);

    await startOnline(user);
    await screen.findByRole("region", { name: /setup placement/i });

    act(() => {
      fakeDriver.pushEvent({ type: "connection", status: "reload-required" });
    });

    expect(await screen.findByText(/please refresh/i)).toBeInTheDocument();
    expect(reloadFn).not.toHaveBeenCalled();
  });

  test("a storage that throws is treated as loop-detected — the notice, NEVER an unguarded reload", async () => {
    const user = userEvent.setup();
    const reloadFn = vi.fn();
    const throwingStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
      getItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
      setItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
      removeItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
    };
    const fakeDriver = renderLiveWithGuard(throwingStorage, reloadFn);

    await startOnline(user);
    await screen.findByRole("region", { name: /setup placement/i });

    act(() => {
      fakeDriver.pushEvent({ type: "connection", status: "reload-required" });
    });

    expect(await screen.findByText(/please refresh/i)).toBeInTheDocument();
    expect(reloadFn).not.toHaveBeenCalled();
  });

  test("a healthy connection:open clears the marker (a resolved mismatch is not a future loop)", async () => {
    const user = userEvent.setup();
    const reloadFn = vi.fn();
    // Simulate the post-reload page: the marker survived the reload in sessionStorage. A successful
    // handshake this load (connection:"open") means the mismatch resolved, so the marker must be cleared.
    const storage = memoryStorage();
    storage.setItem(RELOAD_MARKER_KEY, "1");
    const fakeDriver = renderLiveWithGuard(storage, reloadFn);

    await startOnline(user);
    await screen.findByRole("region", { name: /setup placement/i });

    act(() => {
      fakeDriver.pushEvent({ type: "connection", status: "open" });
    });

    // The marker is gone: a LATER genuine version-mismatch is allowed its one reload, not loop-detected.
    await waitFor(() => expect(storage.getItem(RELOAD_MARKER_KEY)).toBeNull());
    expect(reloadFn).not.toHaveBeenCalled();
  });

  test("a throwing removeItem on connection:open does NOT crash the connection path", async () => {
    const user = userEvent.setup();
    const reloadFn = vi.fn();
    // A storage whose removeItem throws (Safari private-mode / storage-disabled webview). Clearing the
    // marker on a healthy handshake must be guarded so a throw never tears down the live connection.
    const throwingRemove: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
    };
    const fakeDriver = renderLiveWithGuard(throwingRemove, reloadFn);

    await startOnline(user);
    await screen.findByRole("region", { name: /setup placement/i });

    act(() => {
      fakeDriver.pushEvent({ type: "connection", status: "open" });
    });

    // The game is still mounted and interactive — the throw was swallowed, not propagated.
    expect(await screen.findByRole("region", { name: /setup placement/i })).toBeInTheDocument();
    expect(reloadFn).not.toHaveBeenCalled();
  });
});
