// ABOUTME: Transition-matrix tests for the presentation reducer — the pure clock that paces agent
// ABOUTME: beats onto the board (hold frame, queue, emphasis epochs, choreography, log cursor).
import { describe, expect, test } from "vitest";
import {
  INITIAL_PRESENTATION,
  presentationReducer,
  stageableFrom,
  emphasisKeysOf,
  marksOf,
  beatDelayMs,
  BEAT_INTERVAL_MS,
  BEAT_INTERVAL_FAST_MS,
  SET_PIECE_DWELL_MS,
} from "./presentation";
import type { PresentationAction, PresentationState } from "./presentation";
import type { GameEvent, GameState, Hex, LogEntry } from "../engine-client/barrel";

// The reducer never reads INTO a GameState — it shepherds opaque references between the store's
// fold and the board's props — so tagged opaque objects make identity assertions unambiguous.
function opaqueState(tag: string): GameState {
  return { tag } as unknown as GameState;
}
const S0 = opaqueState("s0");
const S1 = opaqueState("s1");
const S2 = opaqueState("s2");
const S3 = opaqueState("s3");

const HEX_A: Hex = { x: 1, y: -1, z: 0 };
const HEX_B: Hex = { x: 2, y: -2, z: 0 };

const placedA: GameEvent = { kind: "placed", piece: "base", hex: HEX_A, owner: 1 };
const placedB: GameEvent = { kind: "placed", piece: "base", hex: HEX_B, owner: 1 };
const combatB: GameEvent = { kind: "combat", target: HEX_B, committed: 4, attackerWon: true };
const destroyedB: GameEvent = { kind: "baseDestroyed", hex: HEX_B, owner: 0 };
const replacedA: GameEvent = { kind: "baseReplaced", hex: HEX_A, from: 0, to: 1 };
const eliminated0: GameEvent = { kind: "eliminated", player: 0, cause: "noBases", bountyTo: null } as GameEvent;

function reduce(s: PresentationState, ...actions: PresentationAction[]): PresentationState {
  return actions.reduce(presentationReducer, s);
}

/** A beat action whose marks default to the events' own hexes — the common (non-placement) case. */
function beat(
  paced: boolean,
  state: GameState | null,
  events: readonly GameEvent[],
  marks: Set<string> = emphasisKeysOf(events),
): PresentationAction {
  return { type: "beat", paced, state, events, marks };
}

const synced = reduce(INITIAL_PRESENTATION, { type: "reset", state: S0 });

describe("emphasisKeysOf", () => {
  test("collects the hexes of placed / combat / baseDestroyed / baseReplaced; eliminated carries none", () => {
    const keys = emphasisKeysOf([placedA, combatB, destroyedB, replacedA, eliminated0]);
    expect(keys).toEqual(new Set(["1,-1,0", "2,-2,0"]));
    expect(emphasisKeysOf([eliminated0])).toEqual(new Set());
  });
});

describe("marksOf", () => {
  test("a placeFirstBase entry marks its hex even though applyEntry emits no events for placements", () => {
    // THE motivating case: agent setup placements arrive as applied beats with events:[] — the
    // entry itself is the only record of what changed on the board.
    const entry: LogEntry = { player: 1, kind: "placeFirstBase", hex: HEX_A, rngBeforeApply: 0n as never };
    expect(marksOf(entry, [])).toEqual(new Set(["1,-1,0"]));
  });

  test("other entry kinds mark exactly their events' hexes", () => {
    const entry: LogEntry = { player: 1, kind: "endRound", rngBeforeApply: 0n as never };
    expect(marksOf(entry, [combatB])).toEqual(new Set(["2,-2,0"]));
    expect(marksOf(entry, [])).toEqual(new Set());
  });
});

describe("presentationReducer — placement beats (events empty, marks carry the change)", () => {
  test("a paced placement beat is VISIBLE — it opens a drain and pulses its mark on present", () => {
    const s = reduce(
      synced,
      { type: "beat", paced: true, state: S1, events: [], marks: new Set(["1,-1,0"]) },
      { type: "tick" },
    );
    expect(s.frame!.state).toBe(S1);
    expect(s.emphasis!.keys).toEqual(new Set(["1,-1,0"]));
    // No events were appended to the log for a placement, so the cursor stays put.
    expect(s.appended).toBe(0);
    expect(s.presented).toBe(0);
  });
});

describe("presentationReducer — reset", () => {
  test("reset installs the sync snapshot as the released scene and clears everything else", () => {
    const busy = reduce(
      synced,
      beat(false, S1, [placedA]),
      beat(true, S2, [placedB]),
    );
    const s = presentationReducer(busy, { type: "reset", state: S3 });
    expect(s.released).toBe(S3);
    expect(s.frame).toBeNull();
    expect(s.queue).toHaveLength(0);
    expect(s.emphasis).toBeNull();
    expect(s.choreography).toBeNull();
    expect(s.appended).toBe(0);
    expect(s.presented).toBe(0);
  });

  test("the emphasis epoch counter survives reset — a post-reset pulse never reuses a pre-reset key", () => {
    const before = reduce(synced, beat(false, S1, [placedA]));
    const preResetEpoch = before.emphasis!.epoch;
    const after = reduce(
      before,
      { type: "reset", state: S2 },
      beat(false, S3, [placedB]),
    );
    expect(after.emphasis!.epoch).toBeGreaterThan(preResetEpoch);
  });
});

describe("presentationReducer — non-paced beats (the human's own echo)", () => {
  test("an idle non-paced beat releases its state, pulses its hexes, and never opens a frame", () => {
    const s = reduce(synced, beat(false, S1, [placedA]));
    expect(s.frame).toBeNull();
    expect(s.queue).toHaveLength(0);
    expect(s.released).toBe(S1);
    expect(s.emphasis!.keys).toEqual(new Set(["1,-1,0"]));
    expect(s.presented).toBe(1);
    expect(s.appended).toBe(1);
  });

  test("a non-paced beat stages its stageable and a later non-stageable beat keeps the reveal lingering", () => {
    const staged = reduce(synced, beat(false, S1, [combatB]));
    expect(staged.choreography).toEqual({ kind: "combat", event: combatB });

    const lingering = reduce(staged, beat(false, S2, [placedA]));
    expect(lingering.choreography).toEqual({ kind: "combat", event: combatB });
  });

  test("a non-paced beat mid-drain snaps the drain and catches the log cursor up", () => {
    const draining = reduce(
      synced,
      beat(true, S1, [placedA]),
      beat(true, S2, [placedB]),
    );
    expect(draining.frame).not.toBeNull();
    const s = reduce(draining, beat(false, S3, [combatB]));
    expect(s.frame).toBeNull();
    expect(s.queue).toHaveLength(0);
    expect(s.released).toBe(S3);
    expect(s.presented).toBe(s.appended);
  });

  test("a fold-degraded beat (no state) leaves the released scene alone", () => {
    const s = reduce(synced, beat(false, null, [placedA]));
    expect(s.released).toBe(S0);
  });

  test("a beat whose only event is an elimination stages the set piece without touching the pulse", () => {
    const withPulse = reduce(synced, beat(false, S1, [placedA]));
    const s = reduce(withPulse, beat(false, S2, [eliminated0]));
    expect(s.choreography).toEqual({ kind: "eliminated", event: eliminated0 });
    expect(s.emphasis).toBe(withPulse.emphasis);
  });
});

describe("presentationReducer — paced beats", () => {
  test("a paced beat arriving idle opens a HOLD frame of the released scene and queues itself", () => {
    // The whole burst lands in one React batch: the hold frame is what makes the human's own
    // move paint alone (with its pulse) while the first agent move waits for the first tick.
    const withEcho = reduce(synced, beat(false, S1, [placedA]));
    const s = reduce(withEcho, beat(true, S2, [placedB]));
    expect(s.frame!.state).toBe(S1);
    expect(s.frame!.events).toHaveLength(0);
    expect(s.queue.map((b) => b.state)).toEqual([S2]);
    expect(s.emphasis).toBe(withEcho.emphasis); // the human's pulse is NOT overwritten in-batch
    expect(s.presented).toBe(1);
    expect(s.appended).toBe(2);
  });

  test("paced beats arriving while a frame presents append to the queue in order", () => {
    const s = reduce(
      synced,
      beat(true, S1, [placedA]),
      beat(true, S2, [placedB]),
      beat(true, S3, [combatB]),
    );
    expect(s.frame!.state).toBe(S0); // the hold
    expect(s.queue.map((b) => b.state)).toEqual([S1, S2, S3]);
  });

  test("a zero-event paced beat at idle advances the released scene without opening a drain", () => {
    const s = reduce(synced, beat(true, S1, []));
    expect(s.frame).toBeNull();
    expect(s.released).toBe(S1);
  });

  test("a zero-event paced beat mid-drain is dropped — later beats' states subsume it", () => {
    const draining = reduce(synced, beat(true, S1, [placedA]));
    const s = reduce(draining, beat(true, S2, []));
    expect(s).toBe(draining);
  });

  test("a paced beat with no released scene (defensive) presents itself immediately", () => {
    const s = reduce(INITIAL_PRESENTATION, beat(true, S1, [placedA]));
    expect(s.frame!.state).toBe(S1);
    expect(s.queue).toHaveLength(0);
    expect(s.emphasis!.keys).toEqual(new Set(["1,-1,0"]));
  });
});

describe("presentationReducer — tick", () => {
  const draining = reduce(
    synced,
    beat(true, S1, [placedA]),
    beat(true, S2, [combatB]),
  );

  test("a tick presents the next queued beat: frame, released, pulse epoch, and the log cursor advance", () => {
    const s = presentationReducer(draining, { type: "tick" });
    expect(s.frame!.state).toBe(S1);
    expect(s.released).toBe(S1);
    expect(s.emphasis!.keys).toEqual(new Set(["1,-1,0"]));
    expect(s.presented).toBe(1);
    expect(s.queue.map((b) => b.state)).toEqual([S2]);
  });

  test("consecutive presented pulses get distinct epochs so the CSS animation restarts", () => {
    const first = presentationReducer(draining, { type: "tick" });
    const second = presentationReducer(first, { type: "tick" });
    expect(second.emphasis!.epoch).toBeGreaterThan(first.emphasis!.epoch);
  });

  test("a tick presenting a stageable beat stages it; a later non-stageable beat keeps it lingering", () => {
    const combatFrame = reduce(draining, { type: "tick" }, { type: "tick" });
    expect(combatFrame.choreography).toEqual({ kind: "combat", event: combatB });

    const more = reduce(
      combatFrame,
      beat(true, S3, [placedB]),
      { type: "tick" },
    );
    expect(more.frame!.state).toBe(S3);
    expect(more.choreography).toEqual({ kind: "combat", event: combatB }); // lingering, same rule as arrival
  });

  test("a tick with an empty queue completes the drain — the tip renders and the log cursor catches up", () => {
    const s = reduce(draining, { type: "tick" }, { type: "tick" }, { type: "tick" });
    expect(s.frame).toBeNull();
    expect(s.presented).toBe(s.appended);
  });

  test("a stray tick while idle is a no-op", () => {
    expect(presentationReducer(synced, { type: "tick" })).toBe(synced);
  });
});

describe("presentationReducer — snap / skip / dismiss", () => {
  const draining = reduce(
    synced,
    beat(true, S1, [combatB]),
    { type: "tick" }, // present the combat beat: stages the reveal
    beat(true, S2, [placedB]),
  );

  test("snap (a prompt arrived) drops the drain to the tip but keeps the staged reveal", () => {
    const s = presentationReducer(draining, { type: "snap", state: S3 });
    expect(s.frame).toBeNull();
    expect(s.queue).toHaveLength(0);
    expect(s.emphasis).toBeNull();
    expect(s.released).toBe(S3); // the tip — a later hold must never rewind past the snap
    expect(s.presented).toBe(s.appended);
    expect(s.choreography).toEqual({ kind: "combat", event: combatB });
  });

  test("skip (the player opted out) drops the drain AND the staged reveal", () => {
    const s = presentationReducer(draining, { type: "skip", state: S3 });
    expect(s.frame).toBeNull();
    expect(s.choreography).toBeNull();
    expect(s.released).toBe(S3);
  });

  test("dismissChoreography clears only the reveal", () => {
    const s = presentationReducer(draining, { type: "dismissChoreography" });
    expect(s.choreography).toBeNull();
    expect(s.frame).toBe(draining.frame);
    expect(s.queue).toBe(draining.queue);
  });
});

describe("beatDelayMs — the tick scheduling policy", () => {
  test("no frame, no timer", () => {
    expect(beatDelayMs(synced)).toBeNull();
  });

  test("a frame that staged a set piece dwells; a long queue accelerates; otherwise the base interval", () => {
    const combatFrame = reduce(
      synced,
      beat(true, S1, [combatB]),
      { type: "tick" },
    );
    expect(beatDelayMs(combatFrame)).toBe(SET_PIECE_DWELL_MS);

    const shortQueue = reduce(synced, beat(true, S1, [placedA]));
    expect(beatDelayMs(shortQueue)).toBe(BEAT_INTERVAL_MS);

    let longQueue = synced;
    for (let i = 0; i < 6; i++) {
      longQueue = presentationReducer(longQueue, beat(true, opaqueState(`q${i}`), [placedA]));
    }
    expect(longQueue.queue.length).toBeGreaterThan(4);
    expect(beatDelayMs(longQueue)).toBe(BEAT_INTERVAL_FAST_MS);
  });
});

describe("the motivating burst — click, own move paints, agents pace in, drain completes", () => {
  test("human echo + three agent placements present one per tick with correct pulses and cursor", () => {
    // The whole burst arrives in ONE synchronous batch (LocalReducerDriver.submit).
    let s = reduce(
      synced,
      beat(false, S1, [placedA]), // the human's own placement
      beat(true, S2, [placedB]), // agent beats…
      beat(true, S3, [combatB]),
    );
    // The batch's single render: the human's move (S1) with the human's pulse; agents queued.
    expect(s.frame!.state).toBe(S1);
    expect(s.emphasis!.keys).toEqual(new Set(["1,-1,0"]));
    expect(s.presented).toBe(1);

    s = presentationReducer(s, { type: "tick" });
    expect(s.frame!.state).toBe(S2);
    expect(s.emphasis!.keys).toEqual(new Set(["2,-2,0"]));
    expect(s.presented).toBe(2);

    s = presentationReducer(s, { type: "tick" });
    expect(s.frame!.state).toBe(S3);
    expect(s.choreography).toEqual({ kind: "combat", event: combatB });
    expect(s.presented).toBe(3);

    s = presentationReducer(s, { type: "tick" });
    expect(s.frame).toBeNull(); // drain complete — the authoritative tip takes over
    expect(s.presented).toBe(s.appended);
  });
});

describe("stageableFrom", () => {
  test("the LATEST stageable event in a batch wins (a combat that eliminates shows the elimination)", () => {
    expect(stageableFrom([combatB, eliminated0])).toEqual({ kind: "eliminated", event: eliminated0 });
    expect(stageableFrom([placedA])).toBeNull();
  });
});
