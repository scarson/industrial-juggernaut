// ABOUTME: GameScreen — the interactive-phase capstone. Wires a GameDriver → the store → the board hero,
// ABOUTME: the contextual composer, the right-rail HUD, the turn-order ceremony, and the combat/elim/victory set pieces.
import { useEffect, useReducer, useRef, useState } from "react";
import { Board } from "../board/Board";
import { highlightSets } from "../board/highlight";
import { controlOf, strandedHexKeys } from "../engine-client/selectors";
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
import {
  INITIAL_PRESENTATION,
  presentationReducer,
  marksOf,
  narrationOf,
  beatDelayMs,
  stageableFrom,
} from "../game/presentation";
import { prefersReducedMotion } from "../design/motion";
import { createRoom } from "../game/rooms";
import { handleReload } from "../game/reload-guard";
import { useSetRailContent } from "./shell/rail-content";
import { useSetShellLabels } from "./shell/shell-labels";
import { selectComposer } from "./select-composer";
import { explainError } from "../rules/error-explanations";
import { turnLabel, seedLabel, gameOverLabel } from "../game/turn-labels";
import { tooltipData } from "../board/tooltip";
import { territoryFills } from "../board/territory";
import { hexKey } from "../board/projection";
import { playerIdentity } from "../identity/player-identity";
import { PlayerShapeIcon } from "../identity/shapes";
import type { GameStore, GameOverTerminal } from "../game/store";
import type { Choreography } from "../game/presentation";
import type { HighlightSets } from "../board/highlight";
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
  // True while a createRoom POST is in flight — disables BOTH start actions so no second start can launch.
  const [onlinePending, setOnlinePending] = useState(false);
  // A monotonically-increasing id stamping each online-start attempt. The async resolve bails if the id
  // it captured is no longer current (a superseded or unmounted start), so a stale/late response can't
  // mount a driver or clobber state. Bumped on unmount (below) to invalidate any request still in flight.
  const startIdRef = useRef(0);
  useEffect(() => () => void (startIdRef.current += 1), []);

  function handleStartOnline(payload: StartOnlinePayload) {
    if (onlinePending) return; // an in-flight start is already running; ignore a repeat click
    const myStartId = (startIdRef.current += 1);
    const isCurrent = () => startIdRef.current === myStartId;
    setOnlineError(null);
    setOnlinePending(true);
    void startOnlineGame(payload, createRoomFn, isCurrent, setStarted, setOnlineError, setOnlinePending);
  }

  if (started === null) {
    // The `/game` entry flow: the NewGame designer IS the pre-game screen. `onStart` starts a LOCAL
    // game; `onStartOnline` creates a room then starts the ONLINE game — both mount PlayView below.
    return (
      <NewGame
        onStart={(h) => setStarted({ mode: "local", header: h })}
        onStartOnline={handleStartOnline}
        onlineError={onlineError}
        startPending={onlinePending}
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
 *
 * `isCurrent` gates EVERY state write: if this attempt was superseded (a later start) or the screen
 * unmounted while the POST was in flight, a late response is IGNORED — it can neither mount a driver nor
 * clobber state. `setPending` is always cleared (when still current) so the start actions re-enable.
 */
async function startOnlineGame(
  payload: StartOnlinePayload,
  createRoomFn: CreateRoomFn,
  isCurrent: () => boolean,
  setStarted: (g: StartedGame) => void,
  setError: (message: string) => void,
  setPending: (pending: boolean) => void,
): Promise<void> {
  try {
    const { roomId, seatTokens } = await createRoomFn(payload.request);
    if (!isCurrent()) return; // superseded/unmounted while the POST was in flight — drop the stale result
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
    if (!isCurrent()) return; // a stale failure must not surface an error on a screen that moved on
    setError(err instanceof Error ? err.message : "Could not create the online game.");
  } finally {
    if (isCurrent()) setPending(false); // re-enable the start actions once THIS attempt settles
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
  // The presentation clock (game/presentation.ts): what the BOARD shows, paced beat by beat, while
  // the store's authoritative fold stays instantaneous. Owns the presented frame, the changed-hex
  // pulse, the combat/elim reveal, and the visible tail of the event narration.
  const [presentation, dispatchPresentation] = useReducer(presentationReducer, INITIAL_PRESENTATION);
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
  const rejection = useGameStore(store, (s) => s.authoritative.rejection);
  const stagedBuild = useGameStore(store, (s) => s.ui.stagedBuild);
  const attackSelection = useGameStore(store, (s) => s.ui.attackSelection);
  // ui.hover is deliberately NOT subscribed here: a pointer crossing publishes on every cell, and
  // a PlayView re-render would reconcile the whole SVG board each time. HexReadout subscribes to
  // it internally, so a hover re-renders only the one-line readout.

  // ── Presentation derivations. While a frame presents, the BOARD (and its labels/readout) shows
  //    the presented scene and the interactive surface is suppressed; everything actionable keeps
  //    reading the authoritative tip. The labels swap to the outcome as soon as the FINAL frame
  //    presents (queue empty + terminal) — the killing-blow scene gets its Victory caption. The
  //    HUD's narration tail is windowed to presented beats so the log never spoils the reveal
  //    (numeric HUD panels stay at the tip — honest numbers). ─────────────────────────────────────
  const presenting = presentation.frame !== null;
  const labelsTerminal = terminal !== null && presentation.queue.length === 0 ? terminal : null;
  const shownEvents = presenting ? eventLog.slice(0, presentation.presented) : eventLog;

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
          dispatchPresentation({ type: "reset", state: event.snapshot });
          setInChainContinue(false);
          return;
        }
        if (event.type === "applied") {
          // A `placeFirstBase` folds with events:[] (round.ts; WEB-8), so narration is synthesized
          // from the entry. The SAME array feeds the log AND the beat below, keeping the
          // presentation's appended/presented cursors in parity with the log's length.
          const narrated = narrationOf(event.entry, event.events);
          dispatchEventLog({ type: "append", events: narrated });
          // The store subscribed first (connectDriver above; drivers fan out in insertion order),
          // so by here it has already folded this entry — the post-fold state IS this beat's
          // frame. If that ordering ever broke, foldOk fails and the beat degrades to an unpaced
          // snap (today's behavior) — never a stale or corrupted frame. A beat by a seat this
          // client controls (the human's own echo) is never paced; note a defender-resolve echo
          // carries the ATTACKER as entry.player, so the human defender's own resolution presents
          // as one held beat of suspense before the combat lands — a chosen behavior.
          const folded = store.getState().authoritative;
          const foldOk = folded.state !== null && folded.logLength === event.logIndex + 1;
          const paced =
            foldOk &&
            !prefersReducedMotion() &&
            !created.controllableSeats().includes(event.entry.player);
          const marks = marksOf(event.entry, event.events);
          dispatchPresentation(
            paced && folded.state !== null
              ? { type: "beat", paced: true, state: folded.state, events: narrated, marks }
              : { type: "beat", paced: false, state: foldOk ? folded.state : null, events: narrated, marks },
          );
          // A landed attack that belongs to a still-acting controllable player opens the chain-continue
          // beat; any other applied (a build, a setup placement, an agent move) clears it.
          setInChainContinue(isChainContinueAfter(event.events));
          return;
        }
        if (event.type === "prompt" || event.type === "gameOver") {
          // A defender prompt or the game ending supersedes any lingering chain-continue offer.
          setInChainContinue(false);
          if (event.type === "prompt") {
            // The human must decide NOW: drop any draining beats to the tip so the decision is
            // made against the true board. The build-up's pacing is deliberately sacrificed to
            // responsiveness. (A staged reveal is kept — Continue dismisses it, as at the tip.)
            dispatchPresentation({ type: "snap", state: store.getState().authoritative.state });
          }
          // gameOver does NOT snap: the killing-blow beats present first, then Victory rises.
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

  // ── The pacing timer: while a frame presents, one timeout advances the drain. beatDelayMs picks
  //    the frame's own delay (set-piece dwell / fast drain / base interval). Keyed on the FRAME's
  //    identity, not the whole presentation state: online, each socket `applied` is its own React
  //    batch, and a dep on `presentation` would rewind the presenting frame's clock on every late
  //    enqueue — the drain would not start advancing until arrivals settled. The ref supplies the
  //    queue-length context at arm time; each presented frame recomputes its own delay. ──────────
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  const presentedFrame = presentation.frame;
  useEffect(() => {
    if (presentedFrame === null) return;
    const delay = beatDelayMs(presentationRef.current);
    if (delay === null) return;
    const timer = setTimeout(() => dispatchPresentation({ type: "tick" }), delay);
    return () => clearTimeout(timer);
  }, [presentedFrame]);

  // ── HUD publication: the shell hosts the right rail, so PlayView publishes its instrument stack as
  //    the rail's content rather than laying out its own rail lane. Re-published whenever the state or
  //    the accumulated event log changes; cleared on unmount so navigating away restores the rail's
  //    placeholder. `state` is null only while the driver connects — nothing to show yet. ────────────
  const setRailContent = useSetRailContent();
  useEffect(() => {
    if (state === null) return;
    setRailContent(<Hud state={state} events={shownEvents} />);
    return () => setRailContent(null);
  }, [setRailContent, state, shownEvents]);

  // ── Shell-labels publication: the top bar's turn chip + seed readout, via the shell-labels seam
  //    (the same discipline as the rail — App never subscribes to game state; only the TopBarHost
  //    re-renders on a publish). Cleared on unmount so leaving the game recedes the readouts. ──────
  const setShellLabels = useSetShellLabels();
  const shellState = presentation.frame?.state ?? state;
  useEffect(() => {
    if (shellState === null) return;
    // The chip captions the DISPLAYED scene — the presented frame while a drain runs, the tip
    // otherwise — and swaps to the outcome once the final frame presents (no phantom turn).
    const label = labelsTerminal !== null ? gameOverLabel(labelsTerminal.winners) : turnLabel(shellState);
    setShellLabels({ turnLabel: label, seedLabel: seedLabel(header) });
    return () => setShellLabels(null);
  }, [setShellLabels, shellState, header, labelsTerminal]);

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
  // What the BOARD (and its banner/readout) shows: the presented frame while beats drain, else the
  // authoritative tip. Everything ACTIONABLE below reads `state` — never `boardState`.
  const boardState = presentation.frame?.state ?? state;
  const stranded = strandedHexKeys(boardState);

  // The keyboard/a11y ACTION path stays each composer's own hex-button list (every legal move is a
  // real, focusable button). The SVG board is ALSO an action surface (UI brief §7 — "click your
  // hex"): a click on a highlighted cell routes to the channel the mounted composer claimed via
  // `ui.boardHandlers` — placement/build/attack are disjoint sets (a placement cell is outer-ring
  // empty, a build cell is empty, an attack cell holds an enemy base), so the highlight channel
  // that offered the cell decides who handles it. `interactiveHexes` limits the click affordance
  // (and its pointer cursor) to exactly the highlighted legal set — no false affordances.
  function handleHexHover(hex: Hex | null) {
    store.setState((s) => ({ ui: { ...s.ui, hover: hex } }));
  }

  function handleHexClick(hex: Hex) {
    const key = hexKey(hex);
    const handlers = store.getState().ui.boardHandlers;
    if (highlights.placementHexes.has(key)) handlers.placement?.(hex);
    else if (highlights.buildHexes.has(key)) handlers.build?.(hex);
    else if (highlights.attackTargets.has(key)) handlers.attackTarget?.(hex);
  }

  // Victory is terminal and persistent — but its set piece waits for the drain, so the killing
  // blow presents (with its pulse) before Victory rises. Reduced motion never drains → instant.
  const showVictory = terminal !== null && !presenting;

  // A finished game affords nothing, and a draining board is not the actionable scene — both drop
  // the legal-move highlight tints. When actionable, the sets derive from the authoritative tip.
  const highlights = showVictory || presenting ? EMPTY_HIGHLIGHTS : highlightSets(state);

  // The click affordance exists ONLY while a composer is mounted to receive it — the same
  // resolution that decides which composer renders (selectComposer) gates which cells afford a
  // click, so an agent's/opponent's turn (waiting), a staged set piece, the chain-continue beat,
  // a draining presentation, and victory never paint pointer cursors over cells no handler backs.
  const composerKind = selectComposer(state, pending, controllableSeats);
  const actingControllable = controllableSeats.includes(currentPlayer(state));
  const interactiveHexes = new Set<string>();
  if (!showVictory && presentation.choreography === null && !presenting) {
    if (composerKind === "setup" && actingControllable) {
      for (const key of highlights.placementHexes) interactiveHexes.add(key);
    } else if (composerKind === "play" && !inChainContinue) {
      for (const key of highlights.buildHexes) interactiveHexes.add(key);
      for (const key of highlights.attackTargets) interactiveHexes.add(key);
    }
  }

  // The board's brass selection: staged-but-uncommitted build pieces plus the attack composer's
  // live target + committed attackers — both published through the store's ui channels. At game
  // over the selection becomes the ending's spatial story instead: the winners' controlling iron
  // (or, for an iron-less elimination winner, their surviving bases), brass-marked — a deliberate
  // Brass Budget brush: the scarce accent floods the winner's engine exactly once, at the moment
  // the game stops being interactive and nothing competes for selection.
  const boardSelection = showVictory
    ? { pieces: victoryMarks(state, terminal.winners) }
    : presenting
      ? null
      : attackSelection !== null
        ? { target: attackSelection.target, attackers: attackSelection.attackers, pieces: stagedBuild }
        : stagedBuild.length > 0
          ? { pieces: stagedBuild }
          : null;

  return (
    <div style={WAR_ROOM_STYLE}>
      <section aria-label="Board" style={BOARD_LANE_STYLE}>
        <TurnBanner state={boardState} terminal={labelsTerminal} />

        <div style={BOARD_WRAP_STYLE}>
          <Board
            state={boardState}
            highlights={highlights}
            strandedHexes={stranded}
            {...(boardSelection !== null ? { selection: boardSelection } : {})}
            onHexClick={handleHexClick}
            interactiveHexes={interactiveHexes}
            onHexHover={handleHexHover}
            {...(presentation.emphasis !== null ? { emphasisHexes: presentation.emphasis } : {})}
          />
        </div>

        <HexReadout state={boardState} store={store} />

        <div aria-label="Composer" style={COMPOSER_LANE_STYLE} data-testid="composer-lane">
          {rejection !== null && !showVictory && !presenting && (
            <div className="table-panel" role="alert" data-testid="rejection-notice" style={REJECTION_STYLE}>
              <span className="mono" style={REJECTION_KICKER_STYLE}>
                not allowed
              </span>
              <p style={REJECTION_BODY_STYLE}>{explainError(rejection.code, state.config)}</p>
            </div>
          )}
          {showVictory ? (
            <Victory winners={terminal.winners} />
          ) : presenting ? (
            // The drain: the lane holds a quiet spectator panel — the presented beat's OWN set
            // piece (sans Continue; the clock advances it), or the waiting line, or (on the
            // terminal frame, already captioned by the banner) nothing. A reveal shows mid-drain
            // only while the beat that staged it is the frame — later beats present around a
            // frozen caption otherwise — while the reducer's lingering choreography still hands
            // off to the tip (Continue dismisses, today's contract). Skip is the one control:
            // it jumps to the tip, dropping the remaining beats AND any staged reveal.
            <div data-testid="presentation-drain" style={CHOREOGRAPHY_STYLE}>
              {presentation.choreography !== null &&
              presentation.frame !== null &&
              stageableFrom(presentation.frame.events) !== null ? (
                <SetPieceView choreography={presentation.choreography} />
              ) : labelsTerminal === null ? (
                <WaitingNotice player={currentPlayer(boardState)} />
              ) : null}
              <div>
                <button
                  type="button"
                  className="chrome-button"
                  data-testid="presentation-skip"
                  onClick={() =>
                    dispatchPresentation({ type: "skip", state: store.getState().authoritative.state })
                  }
                >
                  Skip
                </button>
              </div>
            </div>
          ) : presentation.choreography !== null ? (
            <ChoreographyStage
              choreography={presentation.choreography}
              onContinue={() => dispatchPresentation({ type: "dismissChoreography" })}
            />
          ) : (
            <ActiveComposer
              kind={composerKind}
              state={state}
              pending={pending}
              driver={driver}
              store={store}
              inChainContinue={inChainContinue}
              onAttackAgain={() => setInChainContinue(false)}
            />
          )}

          {/* The turn-order draw is a sanctioned set piece — it never fires over a draining board
              (it would announce an outcome the beats haven't shown yet); it surfaces at the tip. */}
          <TurnOrderCeremony rollover={presenting ? null : rollover} />
        </div>
      </section>
    </div>
  );
}

/** The whose-turn banner beside the board: the acting player's identity token + the turn summary.
 *  Same derivation as the top-bar chip (turn-labels), doubled here because the board lane is where
 *  the player's eye lives during play. A finished game has no acting player, so the banner swaps
 *  to the outcome — every winner's identity token + the game-over label, in the same working type
 *  (the banner is an instrument; the Victory set piece owns the Cartouche drama). */
function TurnBanner({ state, terminal }: { state: GameState; terminal: GameOverTerminal | null }) {
  if (terminal !== null) {
    return (
      <div className="table-panel" data-testid="turn-banner" style={TURN_BANNER_STYLE}>
        {terminal.winners.map((winner) => (
          <PlayerShapeIcon key={winner} identity={playerIdentity(winner)} size={12} />
        ))}
        <span style={TURN_BANNER_TEXT_STYLE}>{gameOverLabel(terminal.winners)}</span>
      </div>
    );
  }
  const acting = currentPlayer(state);
  return (
    <div className="table-panel" data-testid="turn-banner" style={TURN_BANNER_STYLE}>
      <PlayerShapeIcon identity={playerIdentity(acting)} size={12} />
      <span style={TURN_BANNER_TEXT_STYLE}>{turnLabel(state)}</span>
    </div>
  );
}

/** The surveyor readout — a one-line mono strip naming the hovered hex's contents (coordinates,
 *  iron, occupant, controller). Statically positioned under the board: honest, unlayered, and
 *  reachable by assistive tech (no floating tooltip z-index games). Empty hover = an em-dash
 *  placeholder at fixed height so the board doesn't jump as the pointer moves. Subscribes to
 *  `ui.hover` itself (see PlayView) so a pointer crossing re-renders this line, not the board.
 *  A contested overlap hex names EVERY controller (Honest Numbers) — `tooltipData.controlledBy`
 *  alone would misreport it as solely the lowest id's. */
function HexReadout({ state, store }: { state: GameState; store: GameStore }) {
  const hover = useGameStore(store, (s) => s.ui.hover);
  if (hover === null) {
    return (
      <p className="mono" data-testid="hex-readout-idle" style={READOUT_STYLE}>
        —
      </p>
    );
  }
  const data = tooltipData(state, hover);
  const controllers = territoryFills(state).get(hexKey(hover)) ?? [];
  const parts: React.ReactNode[] = [hexKey(hover)];
  if (data.isIron) parts.push("iron");
  if (data.occupant !== null) parts.push(data.occupant);
  if (controllers.length > 1) {
    parts.push(
      <span key="contested" style={READOUT_CONTROLLER_STYLE}>
        contested —{" "}
        {controllers.map((id) => (
          <span key={id} style={READOUT_CONTROLLER_STYLE}>
            <PlayerShapeIcon identity={playerIdentity(id)} size={9} /> Player {id + 1}
          </span>
        ))}
      </span>,
    );
  } else if (controllers.length === 1) {
    parts.push(
      <span key="controller" style={READOUT_CONTROLLER_STYLE}>
        <PlayerShapeIcon identity={playerIdentity(controllers[0]!)} size={9} /> Player{" "}
        {controllers[0]! + 1}
      </span>,
    );
  } else {
    parts.push("unclaimed");
  }
  return (
    <p className="mono" data-testid="hex-readout" style={READOUT_STYLE}>
      {parts.map((part, i) => (
        <span key={i} style={READOUT_PART_STYLE}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {part}
        </span>
      ))}
    </p>
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
  /** The composer resolution PlayView computed via `selectComposer` — passed down (not re-derived)
   *  so the board's click-affordance gate and the mounted composer can never disagree. */
  readonly kind: ReturnType<typeof selectComposer>;
  readonly state: GameState;
  readonly pending: DriverPending | null;
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
  kind,
  state,
  pending,
  driver,
  store,
  inChainContinue,
  onAttackAgain,
}: ActiveComposerProps) {
  const player = currentPlayer(state);

  switch (kind) {
    case "defender":
      return <DefenderPrompt pending={pending} driver={driver} />;
    case "setup":
      return <SetupPlacement state={state} player={player} driver={driver} store={store} />;
    case "forcedPass":
      return <ForcedPassNotice state={state} driver={driver} />;
    case "waiting":
      return <WaitingNotice player={player} />;
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

/** The one spectator line for turns (and draining beats) this client cannot act in. */
function WaitingNotice({ player }: { player: number }) {
  return (
    <ComposerPanel ariaLabel="Waiting">
      <p className="mono" style={WAITING_STYLE} data-testid="waiting-notice">
        Waiting for player {player + 1}…
      </p>
    </ComposerPanel>
  );
}

/** The combat/elimination set piece itself — reduced motion is the pieces' own concern. */
function SetPieceView({ choreography }: { choreography: Choreography }) {
  return choreography.kind === "combat" ? (
    <CombatReveal event={choreography.event} />
  ) : (
    <Elimination event={choreography.event} />
  );
}

/** The winners' controlling iron — or, when an elimination winner controls none (a last-standing
 *  win far from every deposit), their surviving bases — so the ending always marks SOMETHING. */
function victoryMarks(state: GameState, winners: readonly number[]): Hex[] {
  const iron = winners.flatMap((winner) => controlOf(state, winner).iron);
  if (iron.length > 0) return iron;
  return state.bases.filter((base) => winners.includes(base.owner)).map((base) => base.hex);
}

/** Stages the transient combat/elimination set piece at the tip, with the Continue affordance that
 *  dismisses it back to the active composer. While a drain is presenting, the lane renders the
 *  set piece WITHOUT Continue instead (the clock advances; Skip is the drain's one control). */
function ChoreographyStage({
  choreography,
  onContinue,
}: {
  choreography: Choreography;
  onContinue: () => void;
}) {
  return (
    <div data-testid="choreography-stage" style={CHOREOGRAPHY_STYLE}>
      <SetPieceView choreography={choreography} />
      <div>
        <button type="button" className="chrome-button" onClick={onContinue} data-testid="choreography-continue">
          Continue
        </button>
      </div>
    </div>
  );
}

/** No-highlight board treatment — the victory stage (and, with the presentation queue, a draining
 *  presented frame) shows the scene without legal-move tints. Frozen empty sets, never mutated. */
const EMPTY_HIGHLIGHTS: HighlightSets = {
  buildHexes: new Set(),
  factoryHexes: new Set(),
  baseHexes: new Set(),
  attackTargets: new Set(),
  placementHexes: new Set(),
};

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
// The rejection teaching line — oxide kicker on the panel face (linework danger channel, same as
// the board's attack stroke: an annotation, never a fill flood), body in the working sans.
const REJECTION_STYLE: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};
const REJECTION_KICKER_STYLE: React.CSSProperties = {
  fontSize: "0.65rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-oxide)",
};
const REJECTION_BODY_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.85rem",
};
const TURN_BANNER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.4rem 0.75rem",
  alignSelf: "stretch",
};
const TURN_BANNER_TEXT_STYLE: React.CSSProperties = {
  fontSize: "0.9rem",
};
const READOUT_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--color-parchment-300)",
  minHeight: "1.2rem",
  alignSelf: "center",
};
const READOUT_PART_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
};
const READOUT_CONTROLLER_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
};
const LOADING_STYLE: React.CSSProperties = {
  padding: "1rem",
};
const WAITING_STYLE: React.CSSProperties = { margin: 0, color: "var(--color-parchment-300)" };
