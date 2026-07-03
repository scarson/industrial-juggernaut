// ABOUTME: buildFrames — folds a recorded game's log into a precomputed Frame[] for the
// ABOUTME: all-agent viewer's play/pause/step controls; back-stepping is just decrementing an index.
import { applyEntry, initGame } from "../engine-client/barrel";
import type { GameEvent, GameState, LogEntry, SessionHeader } from "../engine-client/barrel";

export type Frame = {
  state: GameState;
  events: GameEvent[];
  logIndex: number; // -1 for the raw setup state; i for the state produced by applying log[i]
};

/**
 * Rebuilds every state the viewer can scrub to, one entry at a time, via `applyEntry` —
 * the same primitive `recordGame`/`replayLog` route through, so viewer playback cannot
 * drift from what was recorded. `frames[0]` is the raw `initGame` output (setup phase,
 * before any log entry); `frames[i + 1]` is the state after applying `log[i]`.
 *
 * Precomputes every frame up front (memory = O(log.length * state size)) so scrubbing
 * and stepping backward are instant array reads rather than replays — a 300-entry log
 * at roughly 8KB per state is a couple of megabytes, trivial for a viewer session.
 */
export function buildFrames(header: SessionHeader, log: LogEntry[]): Frame[] {
  const setupState = initGame({
    seed: header.seed,
    boardSource: header.boardSource,
    nPlayers: header.seats.length,
    config: header.config,
  });

  const frames: Frame[] = [{ state: setupState, events: [], logIndex: -1 }];
  let state = setupState;
  for (let i = 0; i < log.length; i++) {
    const out = applyEntry(state, log[i]!);
    state = out.state;
    frames.push({ state, events: out.events, logIndex: i });
  }
  return frames;
}
