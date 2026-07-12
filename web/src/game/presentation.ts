// ABOUTME: The presentation clock — a pure reducer pacing non-controllable (agent/remote) applied
// ABOUTME: beats onto the board. The store folds instantly; this lens only decides what SHOWS when.
//
// THE SEAM THIS MODULE MUST NEVER CROSS. The authoritative stream (driver → store) folds
// immediately — record/replay and online parity depend on it — and every ACTIONABLE surface
// (composers, highlights, click affordances, selectComposer) reads the authoritative tip. This
// reducer owns only what the player SEES: which folded state the board renders (`frame`), the
// changed-hex pulse (`emphasis`), the combat/elimination reveal (`choreography`), and how much of
// the event narration is shown (`presented` cursor). While a frame presents, GameScreen suppresses
// the whole interactive surface, so a human can never act against a presented (stale) scene.
import { hexKey } from "../board/projection";
import type { GameEvent, GameState } from "../engine-client/barrel";

/** The pacing rhythm. Base spacing sits inside both the spec's 350–500ms ask and the choreography
 *  family (360–680ms); the fast interval bounds long multi-agent drains; the dwell lets a beat
 *  that staged a combat/elimination reveal finish its own 460–640ms signature and be read. */
export const BEAT_INTERVAL_MS = 420;
export const BEAT_INTERVAL_FAST_MS = 240;
/** Queue length beyond which the fast interval applies — a 6-player burst drains bounded. */
export const FAST_QUEUE_THRESHOLD = 4;
export const SET_PIECE_DWELL_MS = 1600;

/**
 * The transient set piece currently staged. A `combat`/`eliminated` GameEvent in a presented
 * beat stages the matching choreography until the player dismisses it (Continue, at the tip),
 * skips the drain, or a later presented stageable supersedes it. Victory is NOT here — it is a
 * persistent terminal state read from the store's `authoritative.terminal`.
 */
export type Choreography =
  | { kind: "combat"; event: Extract<GameEvent, { kind: "combat" }> }
  | { kind: "eliminated"; event: Extract<GameEvent, { kind: "eliminated" }> };

/** The last stageable set-piece event in a batch, or null. A batch can carry several (e.g. a
 *  combat that eliminates a player) — the LATEST wins, matching how the EventLog reads bottom-up. */
export function stageableFrom(events: readonly GameEvent[]): Choreography | null {
  let staged: Choreography | null = null;
  for (const event of events) {
    if (event.kind === "combat") staged = { kind: "combat", event };
    else if (event.kind === "eliminated") staged = { kind: "eliminated", event };
  }
  return staged;
}

/** The board cells a batch visibly changed — the pulse targets. `eliminated`/`victory` carry no
 *  hex; their moment is the set piece, not a cell mark. */
export function emphasisKeysOf(events: readonly GameEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.kind === "placed" || event.kind === "baseDestroyed" || event.kind === "baseReplaced") {
      keys.add(hexKey(event.hex));
    } else if (event.kind === "combat") {
      keys.add(hexKey(event.target));
    }
  }
  return keys;
}

/** One folded beat: the post-fold authoritative state and the batch's events. */
export type PresentationBeat = { state: GameState; events: readonly GameEvent[] };

/** The pulse overlay for the latest presented beat. `epoch` keys the Board's emphasis elements —
 *  a new epoch remounts them so the CSS animation restarts even on a repeat cell. */
export type Emphasis = { keys: Set<string>; epoch: number };

export type PresentationState = {
  /** The scene the board shows whenever no frame presents — the last state released to the tip.
   *  A paced beat arriving idle opens its drain by HOLDING this scene for one interval, which is
   *  what lets the human's own move (folded in the same synchronous batch) paint alone first. */
  released: GameState | null;
  /** Paced beats not yet presented, in arrival order. Non-empty only while `frame` is non-null. */
  queue: readonly PresentationBeat[];
  /** The frame the board currently renders instead of the tip; null = render the tip. */
  frame: PresentationBeat | null;
  emphasis: Emphasis | null;
  /** Monotonic pulse-epoch counter. Survives reset so a post-reset pulse never reuses a key. */
  epoch: number;
  /** Events appended to the arrival-ordered event log (every beat counts, paced or not). */
  appended: number;
  /** Events whose beats have PRESENTED — the visible tail of the event log while a drain runs,
   *  so the narration (and its aria-live announcements) tracks the board instead of spoiling it. */
  presented: number;
  choreography: Choreography | null;
};

export const INITIAL_PRESENTATION: PresentationState = {
  released: null,
  queue: [],
  frame: null,
  emphasis: null,
  epoch: 0,
  appended: 0,
  presented: 0,
  choreography: null,
};

export type PresentationAction =
  /** A fold attempt landed. `paced: false` = the human's own echo, a fold failure, or reduced
   *  motion — show the tip now. `paced: true` = a non-controllable mover's beat (state required:
   *  the post-fold authoritative state) — pace it. */
  | { type: "beat"; paced: boolean; state: GameState | null; events: readonly GameEvent[] }
  /** The pacing timer fired: present the next queued beat, or complete the drain. */
  | { type: "tick" }
  /** A prompt arrived — the human must act NOW. Drop the drain to the tip (`state`), keep the
   *  staged reveal (dismissed by Continue, today's masking semantics). */
  | { type: "snap"; state: GameState | null }
  /** The player skipped the drain: snap AND clear the reveal — "take me to now". */
  | { type: "skip"; state: GameState | null }
  /** A sync installed a fresh authoritative baseline. */
  | { type: "reset"; state: GameState }
  | { type: "dismissChoreography" };

/** The delay before the presenting frame's next tick, or null when no frame presents. A frame
 *  that staged a set piece dwells long enough to be read; a long queue drains fast; otherwise
 *  the base beat interval. */
export function beatDelayMs(s: PresentationState): number | null {
  if (s.frame === null) return null;
  if (stageableFrom(s.frame.events) !== null) return SET_PIECE_DWELL_MS;
  return s.queue.length > FAST_QUEUE_THRESHOLD ? BEAT_INTERVAL_FAST_MS : BEAT_INTERVAL_MS;
}

/** Fold a batch's presentational consequences into `s` as the CURRENTLY PRESENTED content:
 *  pulse (only when the batch marked cells) and reveal (latest stageable, else lingering). */
function present(s: PresentationState, events: readonly GameEvent[]): Pick<PresentationState, "emphasis" | "epoch" | "choreography"> {
  const keys = emphasisKeysOf(events);
  const epoch = keys.size > 0 ? s.epoch + 1 : s.epoch;
  return {
    emphasis: keys.size > 0 ? { keys, epoch } : s.emphasis,
    epoch,
    choreography: stageableFrom(events) ?? s.choreography,
  };
}

export function presentationReducer(s: PresentationState, action: PresentationAction): PresentationState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_PRESENTATION, released: action.state, epoch: s.epoch };

    case "beat": {
      const { paced, state, events } = action;
      if (!paced) {
        // The tip is (or is about to be) the honest scene: snap any drain, release the state,
        // and present this beat's pulse/reveal directly over the tip.
        return {
          ...s,
          ...present(s, events),
          released: state ?? s.released,
          queue: [],
          frame: null,
          appended: s.appended + events.length,
          presented: s.appended + events.length,
        };
      }
      // Paced. An invisible beat (endRound/pass/roundSkipped) never earns an interval: its state
      // is subsumed by later beats mid-drain, or released directly when idle.
      if (events.length === 0) {
        if (s.frame === null) return { ...s, released: state };
        return s;
      }
      const beat: PresentationBeat = { state: state as GameState, events };
      if (s.frame !== null) {
        return { ...s, queue: [...s.queue, beat], appended: s.appended + events.length };
      }
      if (s.released === null) {
        // Defensive: no scene to hold (no sync seen) — present the beat immediately.
        return {
          ...s,
          ...present(s, beat.events),
          released: beat.state,
          frame: beat,
          appended: s.appended + events.length,
          presented: s.appended + events.length,
        };
      }
      // Open the drain by holding the released scene for one interval. In the synchronous burst
      // case the batch's single render therefore paints the human's own move (already released
      // by its non-paced echo) with the human's pulse — the first agent move waits for tick #1.
      return {
        ...s,
        frame: { state: s.released, events: [] },
        queue: [beat],
        appended: s.appended + events.length,
      };
    }

    case "tick": {
      if (s.frame === null) return s; // stray timer
      const [next, ...rest] = s.queue;
      if (next === undefined) {
        // Drain complete: the tip takes over and the full narration is visible.
        return { ...s, frame: null, presented: s.appended };
      }
      return {
        ...s,
        ...present(s, next.events),
        frame: next,
        queue: rest,
        released: next.state,
        presented: s.presented + next.events.length,
      };
    }

    case "snap":
      return {
        ...s,
        queue: [],
        frame: null,
        emphasis: null,
        released: action.state ?? s.released,
        presented: s.appended,
      };

    case "skip":
      return {
        ...presentationReducer(s, { type: "snap", state: action.state }),
        choreography: null,
      };

    case "dismissChoreography":
      return { ...s, choreography: null };
  }
}
