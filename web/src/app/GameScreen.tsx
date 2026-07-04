// ABOUTME: GameScreen — the interactive-phase capstone. Wires a GameDriver → the store → the board hero,
// ABOUTME: the contextual composer, the right-rail HUD, the turn-order ceremony, and the combat/elim/victory set pieces.
import { useEffect, useReducer, useRef, useState } from "react";
import { Board } from "../board/Board";
import { highlightSets } from "../board/highlight";
import { strandedHexKeys } from "../engine-client/selectors";
import { currentPlayer, legalActions } from "../engine-client/barrel";
import { NewGame } from "../designer/NewGame";
import { Hud } from "../hud/Hud";
import { SetupPlacement } from "../composers/SetupPlacement";
import { BuildComposer } from "../composers/BuildComposer";
import { AttackComposer } from "../composers/AttackComposer";
import { DefenderPrompt } from "../composers/DefenderPrompt";
import { ChainContinuePrompt } from "../composers/ChainContinuePrompt";
import { ForcedPassNotice } from "../composers/ForcedPassNotice";
import { TurnOrderCeremony } from "../composers/TurnOrderCeremony";
import { ComposerPanel } from "../composers/shell";
import { CombatReveal } from "../game/choreography/CombatReveal";
import { Elimination } from "../game/choreography/Elimination";
import { Victory } from "../game/choreography/Victory";
import { createGameStore, useGameStore } from "../game/store";
import { createRoom } from "../game/rooms";
import { handleReload } from "../game/reload-guard";
import { useSetRailContent } from "./shell/rail-content";
import { selectComposer } from "./select-composer";
import type { GameStore } from "../game/store";
import type { CreateRoomRequest, CreateRoomResult } from "../game/rooms";
import type { StartOnlinePayload } from "../designer/NewGame";
import type { GameDriver, DriverEvent, DriverPending } from "../game/driver";
import type { GameEvent, GameState, Hex, SessionHeader } from "../engine-client/barrel";

// ─── Driver-injection seam ────────────────────────────────────────────────────────────────────────
/**
 * How GameScreen obtains its `GameDriver` for a started game. In the running app the default
 * DYNAMICALLY imports the LocalReducerDriver (`import("../game/local-reducer-driver")`) so its
 * value-import of `src/agent` (via agent-binding) stays in a lazy chunk the entry graph never pulls
 * — this is what makes `check:bundle` non-vacuous. Tests inject a synchronous factory returning the
 * scripted fake driver, so they never touch the async import or the real reducer.
 */
export type CreateDriver = (header: SessionHeader) => GameDriver | Promise<GameDriver>;

/** The production driver factory: the dynamic-import target. Kept module-scope (not inline in the
 *  effect) so the seam is one named thing tests replace and the entry graph never statically sees. */
const defaultCreateDriver: CreateDriver = async (header) => {
  const { makeLocalReducerDriver } = await import("../game/local-reducer-driver");
  return makeLocalReducerDriver(header);
};

/** The connection the live path binds a SocketDriver to: the created room, the creator's ONE human
 *  seat index, and that seat's token (from `seatTokens[seat]`). */
export type OnlineConnection = { roomId: string; seat: number; token: string };

/**
 * How GameScreen obtains its live `GameDriver` for an online game. In the running app the default
 * DYNAMICALLY imports the SocketDriver (`import("../game/socket-driver")`) so its value-imports of
 * `src/wire` (and the one `src/host/version` constant) stay in a lazy chunk the eager entry graph
 * never pulls — the SAME discipline as the LocalReducerDriver path, and what `check:bundle` enforces.
 * Tests inject a synchronous factory returning a scripted fake driver.
 */
export type CreateOnlineDriver = (conn: OnlineConnection) => GameDriver | Promise<GameDriver>;

/** The production live-driver factory: the SocketDriver dynamic-import target. Module-scope so the
 *  seam is one named thing tests replace and the entry graph never statically pulls src/wire. */
const defaultCreateOnlineDriver: CreateOnlineDriver = async (conn) => {
  const { makeSocketDriver } = await import("../game/socket-driver");
  return makeSocketDriver({ roomId: conn.roomId, seat: conn.seat, token: conn.token });
};

/** The create-room boundary GameScreen calls for an online game — the request-only slice of `createRoom`
 *  (production binds the global `fetch`). Injected in tests so no network is touched. */
export type CreateRoomFn = (req: CreateRoomRequest) => Promise<CreateRoomResult>;

/** The production create-room call: `createRoom` bound to the global `fetch`. */
const defaultCreateRoomFn: CreateRoomFn = (req) => createRoom(req, fetch);

/** The reload-guard's storage slice (defaults to `window.sessionStorage`); narrowed to what the guard reads. */
type ReloadStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Resolve one `connection:"reload-required"` signal into an outcome, wrapping {@link handleReload} so ANY
 * thrown storage exception (Safari private-mode, storage-disabled webviews) is treated as `"loop-detected"`
 * — failing toward the manual-refresh notice, NEVER toward an unguarded reload that could loop.
 */
function guardedReload(reloadFn: () => void, storage: ReloadStorage): "reloaded" | "loop-detected" {
  try {
    return handleReload({ reloadFn, storage });
  } catch {
    return "loop-detected";
  }
}

export interface GameScreenProps {
  /** Injected LOCAL driver factory (defaults to the dynamic-import LocalReducerDriver path). Tests pass
   *  a synchronous factory returning `makeFakeDriver(...)`. */
  readonly createDriver?: CreateDriver;
  /** Injected LIVE driver factory (defaults to the dynamic-import SocketDriver path). Tests pass a
   *  synchronous factory returning `makeFakeDriver(...)` so no real socket opens. */
  readonly createOnlineDriver?: CreateOnlineDriver;
  /** Injected create-room boundary (defaults to `createRoom` over the global `fetch`). Tests inject a
   *  stub so no network is touched. */
  readonly createRoomFn?: CreateRoomFn;
  /** Optional pre-assembled header — starts a LOCAL game immediately, skipping the NewGame entry screen.
   *  Tests use this to mount straight into play; the app leaves it undefined so `/game` shows NewGame. */
  readonly header?: SessionHeader;
  /** Injected store (tests may pass their own to drive assertions; defaults to a fresh instance). */
  readonly store?: GameStore;
  /** Injected reload for the version-mismatch guard (defaults to `() => window.location.reload()`). */
  readonly reloadFn?: () => void;
  /** Injected reload-guard marker storage (defaults to `window.sessionStorage`). */
  readonly reloadStorage?: ReloadStorage;
}

/**
 * A started game and the transport it runs over: a LOCAL game (the hotseat/offline LocalReducerDriver,
 * built from the header) or an ONLINE game (the SocketDriver, built from the resolved room connection).
 * `header` is the started-game identity + PlayView remount key in both cases.
 */
type StartedGame =
  | { mode: "local"; header: SessionHeader }
  | { mode: "online"; header: SessionHeader; connection: OnlineConnection };

// ─── Event accumulation seam ──────────────────────────────────────────────────────────────────────
/**
 * The store's `authoritative` slice does NOT carry a cumulative event list — it folds STATE, not a
 * running narration. GameScreen accumulates the events itself: a `sync` resets the log to empty (a
 * fresh authoritative baseline), and every `applied` appends its `events` batch. This mirrors the
 * P2.7 viewer's `eventsUpTo` cumulative narration, but sourced from the live stream rather than a
 * precomputed frame array. The accumulated list feeds the HUD's EventLog.
 */
type EventLogAction = { type: "sync" } | { type: "append"; events: readonly GameEvent[] };

function eventLogReducer(log: GameEvent[], action: EventLogAction): GameEvent[] {
  switch (action.type) {
    case "sync":
      return [];
    case "append":
      return action.events.length === 0 ? log : [...log, ...action.events];
  }
}

/**
 * The transient set piece currently staged, if any. A `combat`/`eliminated` GameEvent arriving in an
 * `applied` batch stages the matching choreography until the player dismisses it (Continue) or the
 * next authoritative action supersedes it. Victory is NOT here — it is a persistent terminal state
 * read from the store's `authoritative.terminal` (the top-level `gameOver` DriverEvent), never dismissed.
 */
type Choreography =
  | { kind: "combat"; event: Extract<GameEvent, { kind: "combat" }> }
  | { kind: "eliminated"; event: Extract<GameEvent, { kind: "eliminated" }> };

/** The last stageable set-piece event in a batch, or null. A batch can carry several (e.g. a combat
 *  that eliminates a player) — the LATEST wins, so the elimination is what's shown, matching how the
 *  EventLog reads bottom-up. Combat and elimination each get their own moment across successive batches. */
function stageableFrom(events: readonly GameEvent[]): Choreography | null {
  let staged: Choreography | null = null;
  for (const event of events) {
    if (event.kind === "combat") staged = { kind: "combat", event };
    else if (event.kind === "eliminated") staged = { kind: "eliminated", event };
  }
  return staged;
}

/**
 * The interactive game screen. Two states: BEFORE a game is started it shows the NewGame designer
 * (the `/game` entry flow — `onStart(header)` starts the game); AFTER, it mounts the war-room layout
 * (board hero + contextual composer + HUD rail) driven by the connected GameDriver.
 */
export function GameScreen({
  createDriver = defaultCreateDriver,
  createOnlineDriver = defaultCreateOnlineDriver,
  createRoomFn = defaultCreateRoomFn,
  header,
  store: injectedStore,
  reloadFn = defaultReloadFn,
  reloadStorage,
}: GameScreenProps) {
  const [started, setStarted] = useState<StartedGame | null>(header ? { mode: "local", header } : null);
  // A create-room failure surfaced back on the designer (the online action's async error path).
  const [onlineError, setOnlineError] = useState<string | null>(null);

  if (started === null) {
    // The `/game` entry flow: the NewGame designer IS the pre-game screen. `onStart` starts a LOCAL
    // game; `onStartOnline` creates a room then starts the ONLINE game — both mount PlayView below.
    return (
      <NewGame
        onStart={(h) => setStarted({ mode: "local", header: h })}
        onStartOnline={(payload) => {
          setOnlineError(null);
          void startOnlineGame(payload, createRoomFn, setStarted, setOnlineError);
        }}
        onlineError={onlineError}
      />
    );
  }

  // The started game routes through the SAME PlayView/store/composers stack regardless of transport —
  // the only difference is which driver factory `createDriver` resolves to (local reducer vs socket).
  const playCreateDriver: CreateDriver =
    started.mode === "local" ? createDriver : () => createOnlineDriver(started.connection);

  return (
    <PlayView
      key={headerKey(started.header)}
      header={started.header}
      createDriver={playCreateDriver}
      injectedStore={injectedStore}
      reloadFn={reloadFn}
      reloadStorage={reloadStorage}
    />
  );
}

/** The production reload — a real hard reload of the current page. Module-scope so tests replace it via
 *  the `reloadFn` prop and never trigger a real navigation. */
function defaultReloadFn(): void {
  window.location.reload();
}

/**
 * Create the room for an online game, then start it. On success the resolved `{ roomId, seatTokens }` is
 * paired with the creator's ONE human seat (the first — and, per the one-human gate, only — human seat)
 * and its token into the `online` StartedGame. A `createRoom` failure surfaces its message on the designer.
 */
async function startOnlineGame(
  payload: StartOnlinePayload,
  createRoomFn: CreateRoomFn,
  setStarted: (g: StartedGame) => void,
  setError: (message: string) => void,
): Promise<void> {
  try {
    const { roomId, seatTokens } = await createRoomFn(payload.request);
    const seat = payload.request.seats.findIndex((s) => s.kind === "human");
    const token = seat >= 0 ? seatTokens[seat] : null;
    if (seat < 0 || token == null) {
      // Defense in depth: the one-human gate guarantees a human seat with a token, so this is a host
      // contract violation (a human seat minted no token) — surface it rather than connect tokenless.
      setError("Could not start the online game — no seat token was issued for your seat.");
      return;
    }
    setStarted({ mode: "online", header: payload.header, connection: { roomId, seat, token } });
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not create the online game.");
  }
}

/** A stable identity for a header so a NEW game (a fresh onStart, or a different header prop) remounts
 *  PlayView from scratch — a new store, a new driver, a cleared event log. Seed + seat count + config
 *  identity is enough to distinguish "start again" from a re-render of the same game. */
function headerKey(header: SessionHeader): string {
  return `${header.seed.toString()}:${header.seats.length}`;
}

interface PlayViewProps {
  readonly header: SessionHeader;
  readonly createDriver: CreateDriver;
  readonly injectedStore: GameStore | undefined;
  readonly reloadFn: () => void;
  readonly reloadStorage: ReloadStorage | undefined;
}

/**
 * The war-room layout for a started game. Owns: the store, the driver lifecycle (connect on mount,
 * dispose on unmount), the accumulated event log, and the transient choreography. Split from
 * GameScreen so the `key`-remount on a new game gives every started game a pristine store + driver.
 */
function PlayView({ header, createDriver, injectedStore, reloadFn, reloadStorage }: PlayViewProps) {
  // One store per started game (stable across this PlayView's life; a new game remounts PlayView).
  const storeRef = useRef<GameStore | undefined>(injectedStore);
  if (storeRef.current === undefined) storeRef.current = createGameStore();
  const store = storeRef.current;

  const [driver, setDriver] = useState<GameDriver | null>(null);
  const [eventLog, dispatchEventLog] = useReducer(eventLogReducer, []);
  const [choreography, setChoreography] = useState<Choreography | null>(null);
  // The chain-continue beat: set true after an attack `applied` lands on the acting player's turn, so
  // the screen offers "attack again / done" instead of re-opening the AttackComposer immediately.
  const [inChainContinue, setInChainContinue] = useState(false);
  // Set when a version-mismatch reload was suppressed as a loop (the second signal this page load, or a
  // storage exception) — the cue to show the manual-refresh notice instead of reloading again.
  const [reloadLoopDetected, setReloadLoopDetected] = useState(false);

  const state = useGameStore(store, (s) => s.authoritative.state);
  const pending = useGameStore(store, (s) => s.authoritative.pending);
  const rollover = useGameStore(store, (s) => s.authoritative.turnRollover);
  const terminal = useGameStore(store, (s) => s.authoritative.terminal);
  const connection = useGameStore(store, (s) => s.authoritative.connection);
  const selection = useGameStore(store, (s) => s.ui.selection);

  // ── Driver lifecycle: create (possibly async) → subscribe → dispose. Both subscriptions (the
  //    store's `connectDriver` and the event-log/choreography handler below) are established in the
  //    SAME callback that makes the driver available, not a dependent `[driver]` effect a tick later.
  //    `Promise.resolve(x).then(cb)` always defers `cb` to a microtask, so a separate effect keyed on
  //    `driver` state would only subscribe after a further passive-effect flush — a real gap in which
  //    a pushed event arrives before any subscriber exists and is silently dropped. Subscribing here,
  //    synchronously within the resolution callback, closes that gap. ──────────────────────────────
  useEffect(() => {
    let disposed = false;
    let live: GameDriver | null = null;
    let unsubscribeStore: (() => void) | null = null;
    let unsubscribeEventLog: (() => void) | null = null;

    Promise.resolve(createDriver(header)).then((created) => {
      if (disposed) {
        created.dispose();
        return;
      }
      live = created;
      unsubscribeStore = store.getState().connectDriver(created);
      // Reads the same authoritative stream as the store's `connectDriver`, for the cumulative
      // narration and set-piece triggers — `applied.events` never lands in a store slice, since the
      // store discards the batch after folding it into state.
      unsubscribeEventLog = created.subscribe((event: DriverEvent) => {
        if (event.type === "sync") {
          dispatchEventLog({ type: "sync" });
          setChoreography(null);
          setInChainContinue(false);
          return;
        }
        if (event.type === "applied") {
          dispatchEventLog({ type: "append", events: event.events });
          const staged = stageableFrom(event.events);
          if (staged !== null) setChoreography(staged);
          // A landed attack that belongs to a still-acting controllable player opens the chain-continue
          // beat; any other applied (a build, a setup placement, an agent move) clears it.
          setInChainContinue(isChainContinueAfter(event.events));
          return;
        }
        if (event.type === "prompt" || event.type === "gameOver") {
          // A defender prompt or the game ending supersedes any lingering chain-continue offer.
          setInChainContinue(false);
        }
      });
      setDriver(created);
    });

    return () => {
      disposed = true;
      unsubscribeStore?.();
      unsubscribeEventLog?.();
      live?.dispose();
    };
  }, [header, createDriver, store]);

  // ── HUD publication: the shell hosts the right rail, so PlayView publishes its instrument stack as
  //    the rail's content rather than laying out its own rail lane. Re-published whenever the state or
  //    the accumulated event log changes; cleared on unmount so navigating away restores the rail's
  //    placeholder. `state` is null only while the driver connects — nothing to show yet. ────────────
  const setRailContent = useSetRailContent();
  useEffect(() => {
    if (state === null) return;
    setRailContent(<Hud state={state} events={eventLog} />);
    return () => setRailContent(null);
  }, [setRailContent, state, eventLog]);

  // ── Version-mismatch reload guard: when the driver reports `connection:"reload-required"` (the
  //    SocketDriver's mapping of a `reload` ServerMessage), reload the page ONCE per load. A second
  //    signal in the same load — or a storage exception — is a loop, so we show the manual-refresh
  //    notice instead (guardedReload fails toward the notice, never an unguarded reload). Keyed on
  //    `connection` so it fires once per transition into "reload-required", not on every render. ─────
  useEffect(() => {
    if (connection !== "reload-required") return;
    const outcome = guardedReload(reloadFn, reloadStorage ?? window.sessionStorage);
    if (outcome === "loop-detected") setReloadLoopDetected(true);
  }, [connection, reloadFn, reloadStorage]);

  if (reloadLoopDetected) {
    return (
      <section className="table-panel" aria-label="Reload required" role="alert" style={LOADING_STYLE}>
        <p className="mono">
          This game was updated. Please refresh the page to continue.
        </p>
      </section>
    );
  }

  if (driver === null || state === null) {
    return (
      <section className="table-panel" aria-label="Game loading" style={LOADING_STYLE}>
        <p className="mono">Loading game…</p>
      </section>
    );
  }

  const controllableSeats = driver.controllableSeats();
  const highlights = highlightSets(state);
  const stranded = strandedHexKeys(state);

  // The ACTION path is each composer's own hex-button list (the a11y path — every legal move is a
  // real, keyboard-reachable button). The SVG board is a reading/pointing surface: hover publishes to
  // the store's `ui.hover` slice (the documented hover seam), and no `onHexClick` is wired because
  // the composers own their in-progress selection internally — routing an SVG click into a composer's
  // private staging state would require a seam the composers deliberately don't expose (P3.4 note).
  // The board still reflects a composer's published `ui.selection` when one exists (today: none, so
  // `selection` stays null and the board shows highlights + stranded only).
  function handleHexHover(hex: Hex | null) {
    store.setState((s) => ({ ui: { ...s.ui, hover: hex } }));
  }

  // Victory is terminal and persistent — it outranks the whole interactive surface once the game ends.
  const showVictory = terminal !== null;

  return (
    <div style={WAR_ROOM_STYLE}>
      <section aria-label="Board" style={BOARD_LANE_STYLE}>
        <div style={BOARD_WRAP_STYLE}>
          <Board
            state={state}
            highlights={highlights}
            strandedHexes={stranded}
            {...(selection != null ? { selection } : {})}
            onHexHover={handleHexHover}
          />
        </div>

        <div aria-label="Composer" style={COMPOSER_LANE_STYLE} data-testid="composer-lane">
          {showVictory ? (
            <Victory winners={terminal.winners} />
          ) : choreography !== null ? (
            <ChoreographyStage choreography={choreography} onContinue={() => setChoreography(null)} />
          ) : (
            <ActiveComposer
              state={state}
              pending={pending}
              controllableSeats={controllableSeats}
              driver={driver}
              store={store}
              inChainContinue={inChainContinue}
              onAttackAgain={() => setInChainContinue(false)}
            />
          )}

          <TurnOrderCeremony rollover={rollover} />
        </div>
      </section>
    </div>
  );
}

/** Whether a landed batch's events mean the acting player may still attack again this round — i.e. a
 *  combat resolved (an attack landed) in this batch. The precise "can attack again" existence check is
 *  the ChainContinuePrompt's `canAttackAgain` prop, derived below from `legalActions`; this only
 *  decides whether the chain-continue BEAT opens at all (an attack happened), not whether the button shows. */
function isChainContinueAfter(events: readonly GameEvent[]): boolean {
  return events.some((e) => e.kind === "combat");
}

interface ActiveComposerProps {
  readonly state: GameState;
  readonly pending: DriverPending | null;
  readonly controllableSeats: readonly number[];
  readonly driver: GameDriver;
  readonly store: GameStore;
  readonly inChainContinue: boolean;
  readonly onAttackAgain: () => void;
}

/**
 * Renders the ONE contextual composer `selectComposer` resolves to. The `play` kind is itself two
 * composers (Build + Attack) side by side, plus — after a landed attack — the ChainContinuePrompt
 * instead of the pair, until the player chooses to attack again or end the round.
 */
function ActiveComposer({
  state,
  pending,
  controllableSeats,
  driver,
  store,
  inChainContinue,
  onAttackAgain,
}: ActiveComposerProps) {
  const kind = selectComposer(state, pending, controllableSeats);
  const player = currentPlayer(state);

  switch (kind) {
    case "defender":
      return <DefenderPrompt pending={pending} driver={driver} />;
    case "setup":
      return <SetupPlacement state={state} player={player} driver={driver} />;
    case "forcedPass":
      return <ForcedPassNotice state={state} driver={driver} />;
    case "waiting":
      return (
        <ComposerPanel ariaLabel="Waiting">
          <p className="mono" style={WAITING_STYLE} data-testid="waiting-notice">
            Waiting for player {player + 1}…
          </p>
        </ComposerPanel>
      );
    case "play":
      if (inChainContinue) {
        const canAttackAgain = legalActions(state).some((a) => a.kind === "attack");
        return (
          <ChainContinuePrompt driver={driver} canAttackAgain={canAttackAgain} onAttackAgain={onAttackAgain} />
        );
      }
      return (
        <div style={PLAY_COMPOSERS_STYLE} data-testid="play-composers">
          <BuildComposer state={state} player={player} driver={driver} store={store} />
          <AttackComposer state={state} player={player} driver={driver} store={store} />
        </div>
      );
  }
}

/** Stages the transient combat/elimination set piece with a Continue affordance to dismiss it and
 *  return to the active composer. The set pieces themselves handle reduced motion. */
function ChoreographyStage({
  choreography,
  onContinue,
}: {
  choreography: Choreography;
  onContinue: () => void;
}) {
  return (
    <div data-testid="choreography-stage" style={CHOREOGRAPHY_STYLE}>
      {choreography.kind === "combat" ? (
        <CombatReveal event={choreography.event} />
      ) : (
        <Elimination event={choreography.event} />
      )}
      <div>
        <button type="button" className="chrome-button" onClick={onContinue} data-testid="choreography-continue">
          Continue
        </button>
      </div>
    </div>
  );
}

// ─── Layout — the war-room lane (UI brief §5): board is the hero (left-weighted, brightest) and the
//     composer appears contextually beneath/beside it; the HUD is published to the shell's right rail
//     (see the HUD-publication effect above). Geometry only; colors come from tokens via CSS variables
//     and the components' own classes. ─────────────────────────────────────────────────────────────
const WAR_ROOM_STYLE: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  padding: "1rem",
  alignItems: "flex-start",
  minHeight: 0,
};
const BOARD_LANE_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};
const BOARD_WRAP_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: "56rem",
  aspectRatio: "4 / 3",
  alignSelf: "center",
};
const COMPOSER_LANE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};
const PLAY_COMPOSERS_STYLE: React.CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
  alignItems: "flex-start",
};
const CHOREOGRAPHY_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};
const LOADING_STYLE: React.CSSProperties = {
  padding: "1rem",
};
const WAITING_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
