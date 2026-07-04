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
import { useSetRailContent } from "./shell/rail-content";
import { selectComposer } from "./select-composer";
import type { GameStore } from "../game/store";
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

export interface GameScreenProps {
  /** Injected driver factory (defaults to the dynamic-import LocalReducerDriver path). Tests pass a
   *  synchronous factory returning `makeFakeDriver(...)`. */
  readonly createDriver?: CreateDriver;
  /** Optional pre-assembled header — starts a game immediately, skipping the NewGame entry screen.
   *  Tests use this to mount straight into play; the app leaves it undefined so `/game` shows NewGame. */
  readonly header?: SessionHeader;
  /** Injected store (tests may pass their own to drive assertions; defaults to a fresh instance). */
  readonly store?: GameStore;
}

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
export function GameScreen({ createDriver = defaultCreateDriver, header, store: injectedStore }: GameScreenProps) {
  const [startedHeader, setStartedHeader] = useState<SessionHeader | null>(header ?? null);

  if (startedHeader === null) {
    // The `/game` entry flow: the NewGame designer IS the pre-game screen. `onStart(header)` starts
    // the game — mounting PlayView below with that header. NewGame supplies its own "New game" heading.
    return <NewGame onStart={setStartedHeader} />;
  }

  return (
    <PlayView
      key={headerKey(startedHeader)}
      header={startedHeader}
      createDriver={createDriver}
      injectedStore={injectedStore}
    />
  );
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
}

/**
 * The war-room layout for a started game. Owns: the store, the driver lifecycle (connect on mount,
 * dispose on unmount), the accumulated event log, and the transient choreography. Split from
 * GameScreen so the `key`-remount on a new game gives every started game a pristine store + driver.
 */
function PlayView({ header, createDriver, injectedStore }: PlayViewProps) {
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

  const state = useGameStore(store, (s) => s.authoritative.state);
  const pending = useGameStore(store, (s) => s.authoritative.pending);
  const rollover = useGameStore(store, (s) => s.authoritative.turnRollover);
  const terminal = useGameStore(store, (s) => s.authoritative.terminal);
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
