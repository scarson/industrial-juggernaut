// ABOUTME: AgentViewer — the /viewer screen where designers WATCH a game play itself: generate an
// ABOUTME: all-agent game (or import a record), then step / scrub / play-pause its precomputed frames.
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import { Board } from "../board/Board";
import { EventLog } from "../hud/EventLog";
import { buildFrames, type Frame } from "./stepper";
import { generateGame as defaultGenerateGame, type GenerateWorker } from "./generate-client";
import { parseSessionRecord } from "./import-record";
import { applyPreset, presets, type PresetName } from "../designer/presets";
import { assembleHeader, MAX_SEATS, MIN_SEATS, parseSeed } from "../designer/new-game-form";
import { duration, prefersReducedMotion } from "../design/motion";
import { defaultConfig } from "../engine-client/barrel";
import type { GameEvent, SeatConfig, SessionHeader } from "../engine-client/barrel";
import type { RecordResult } from "../../../src/session/record";

/** The generateGame seam — injected so tests supply a fake; production defaults to the real worker. */
export type GenerateGame = (
  req: { header: SessionHeader; turnCap: number },
  workerFactory?: () => GenerateWorker,
) => Promise<RecordResult>;

export interface AgentViewerProps {
  /** Optional pre-filled header (e.g. handed from the new-game designer). Seeds the mini-form. */
  readonly header?: SessionHeader;
  /** Injected generation function (defaults to the real off-main-thread worker). */
  readonly generateGame?: GenerateGame;
}

/** How long a game may run before the recorder gives up (a backstop; most games end well before). */
const TURN_CAP = 200;

/** Speed multipliers offered by the transport's speed control. 1x = one frame per `duration.slow`. */
const SPEEDS = [0.5, 1, 2, 4] as const;

/**
 * The all-agent viewer. Two ways in: GENERATE a fresh all-agent game via the injected
 * `generateGame` (the off-main-thread worker in production), or IMPORT a pasted `SessionRecord`
 * (the agent-free path — `parseSessionRecord` decodes it without ever touching the generator).
 * Either way the recorded log is folded to `Frame[]` once via `buildFrames`, and the transport
 * (step / scrub / play-pause) just moves an index into that precomputed array.
 *
 * Design notes:
 * - Mini-form, not the full NewGame: a compact seat-count / seed / preset trio assembles the
 *   header (board source = a generated board at the config's size). The `header` prop, when given,
 *   seeds those fields — enough to watch a game without re-deriving the whole designer instrument.
 * - Play tick: one frame per `duration.slow` (250ms) at 1x, divided by the speed multiplier.
 *   Playback is independent of `prefersReducedMotion()` — frame advancement is content, not
 *   decoration, so watching the game never stops; the preference is surfaced as a readout so
 *   the choreographed set pieces (combat/elimination/victory, a later phase) know to gate
 *   their animations when they exist. The board today renders each frame as a plain SVG swap
 *   with no transitions to suppress.
 */
export function AgentViewer({ header, generateGame = defaultGenerateGame }: AgentViewerProps) {
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [generating, setGenerating] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  const lastIndex = frames ? frames.length - 1 : 0;

  // ----- mini-form state -----
  const [form, dispatchForm] = useReducer(formReducer, header, initForm);

  const loadFrames = useCallback((next: Frame[]) => {
    setFrames(next);
    setCurrent(0);
    setPlaying(false);
    setErrors(null);
  }, []);

  async function handleGenerate() {
    setErrors(null);
    setGenerating(true);
    setPlaying(false);
    try {
      const assembled = assembleFromForm(form);
      if (!assembled.ok) {
        setErrors(assembled.errors);
        return;
      }
      const result = await generateGame({ header: assembled.header, turnCap: TURN_CAP });
      loadFrames(buildFrames(result.header, result.log));
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setGenerating(false);
    }
  }

  const [importText, setImportText] = useState("");
  function handleImport() {
    const result = parseSessionRecord(importText);
    if (!result.ok) {
      setFrames(null);
      setErrors(result.errors);
      return;
    }
    loadFrames(buildFrames(result.record.header, result.record.log));
  }

  const stepForward = useCallback(() => setCurrent((c) => Math.min(c + 1, lastIndex)), [lastIndex]);
  const stepBack = useCallback(() => setCurrent((c) => Math.max(c - 1, 0)), []);

  // ----- playback timer -----
  const tickMs = Math.max(1, Math.round(duration.slow / speed));
  useEffect(() => {
    if (!playing || frames === null) return;
    if (current >= lastIndex) {
      setPlaying(false);
      return;
    }
    const id = setInterval(() => {
      setCurrent((c) => {
        if (c >= lastIndex) return c; // clamp; the effect below stops the timer next render
        return c + 1;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [playing, frames, current, lastIndex, tickMs]);

  const frame = frames?.[current] ?? null;

  // Cumulative narration: the log auto-follows, showing every event up to and INCLUDING the current
  // frame (frame 0 has none). A single frame carries only its own 0-2 events; the viewer's log is
  // the running story, which is why EventLog windows a long tail. Recomputed only when the frame set
  // or position changes.
  const eventsUpTo = useMemo<GameEvent[]>(() => {
    if (frames === null) return [];
    const out: GameEvent[] = [];
    for (let i = 0; i <= current && i < frames.length; i++) out.push(...frames[i]!.events);
    return out;
  }, [frames, current]);

  return (
    <section className="table-panel" aria-label="Agent viewer" style={PANEL_STYLE}>
      <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Viewer</h1>

      <MiniForm form={form} dispatch={dispatchForm} onGenerate={handleGenerate} generating={generating} />

      <ImportField
        value={importText}
        onChange={setImportText}
        onImport={handleImport}
      />

      {errors && (
        <ul role="alert" className="mono" style={ERROR_STYLE}>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {frame && frames && (
        <div style={STAGE_STYLE}>
          <div style={BOARD_WRAP_STYLE}>
            <Board state={frame.state} />
          </div>

          <Transport
            current={current}
            lastIndex={lastIndex}
            playing={playing}
            speed={speed}
            reducedMotion={prefersReducedMotion()}
            onStepBack={stepBack}
            onStepForward={stepForward}
            onTogglePlay={() => setPlaying((p) => !p)}
            onScrub={(v) => {
              setPlaying(false);
              setCurrent(Math.max(0, Math.min(v, lastIndex)));
            }}
            onSpeed={setSpeed}
          />

          <EventLog events={eventsUpTo} />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mini-form — a compact seat-count / seed / preset trio (not the full NewGame).
// ---------------------------------------------------------------------------

interface FormState {
  seatCount: number;
  seed: string;
  preset: PresetName;
}

type FormAction =
  | { type: "seatCount"; value: number }
  | { type: "seed"; value: string }
  | { type: "preset"; value: PresetName };

function initForm(header: SessionHeader | undefined): FormState {
  const firstPreset = Object.keys(presets())[0] as PresetName;
  return {
    seatCount: header ? clampSeatCount(header.seats.length) : MIN_SEATS,
    seed: header ? header.seed.toString() : "1",
    preset: firstPreset,
  };
}

function clampSeatCount(n: number): number {
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, n));
}

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "seatCount":
      return { ...state, seatCount: clampSeatCount(action.value) };
    case "seed":
      return { ...state, seed: action.value };
    case "preset":
      return { ...state, preset: action.value };
  }
}

/** Assembles a SessionHeader from the mini-form, or returns friendly errors (a bad seed). */
function assembleFromForm(
  form: FormState,
): { ok: true; header: SessionHeader } | { ok: false; errors: string[] } {
  const seed = parseSeed(form.seed);
  if (!seed.ok) return { ok: false, errors: [seed.message] };

  const config = applyPreset(form.preset);
  // All-agent: every seat is a greedy agent (the viewer watches agents play; humans would stall it).
  const seats: SeatConfig[] = Array.from({ length: form.seatCount }, () => ({
    kind: "agent",
    agent: "greedy",
    archetype: "aggressive",
  }));
  const header = assembleHeader({
    seed: seed.seed,
    config,
    boardSource: { kind: "generate", size: config.boardSize, ironCount: config.ironCount },
    seats,
  });
  return { ok: true, header };
}

interface MiniFormProps {
  form: FormState;
  dispatch: (a: FormAction) => void;
  onGenerate: () => void;
  generating: boolean;
}

function MiniForm({ form, dispatch, onGenerate, generating }: MiniFormProps) {
  const presetNames = Object.keys(presets()) as PresetName[];
  return (
    <fieldset aria-label="Generate a game" style={CLUSTER_STYLE}>
      <legend className="mono" style={LEGEND_STYLE}>
        Generate
      </legend>
      <div style={FORM_ROW_STYLE}>
        <label style={FIELD_STYLE}>
          <span>Players</span>
          <input
            className="mono"
            type="number"
            aria-label="Players"
            min={MIN_SEATS}
            max={MAX_SEATS}
            step={1}
            value={form.seatCount}
            style={NUMBER_INPUT_STYLE}
            onChange={(e) => dispatch({ type: "seatCount", value: Number(e.target.value) })}
          />
        </label>
        <label style={FIELD_STYLE}>
          <span>Seed</span>
          <input
            className="mono"
            type="text"
            inputMode="numeric"
            aria-label="Seed"
            value={form.seed}
            style={NUMBER_INPUT_STYLE}
            onChange={(e) => dispatch({ type: "seed", value: e.target.value })}
          />
        </label>
        <label style={FIELD_STYLE}>
          <span>Preset</span>
          <select
            className="chrome-button mono"
            aria-label="Preset"
            value={form.preset}
            onChange={(e) => dispatch({ type: "preset", value: e.target.value as PresetName })}
          >
            {presetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <button
          type="button"
          className="chrome-button brass-accent-bg"
          disabled={generating}
          onClick={onGenerate}
        >
          {generating ? "Generating…" : "Generate"}
        </button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Import field — paste a SessionRecord for the agent-free path.
// ---------------------------------------------------------------------------

function ImportField({
  value,
  onChange,
  onImport,
}: {
  value: string;
  onChange: (v: string) => void;
  onImport: () => void;
}) {
  return (
    <fieldset aria-label="Import a record" style={CLUSTER_STYLE}>
      <legend className="mono" style={LEGEND_STYLE}>
        Import
      </legend>
      <label style={{ ...FIELD_STYLE, alignItems: "flex-start" }}>
        <span>Record JSON</span>
        <textarea
          className="mono"
          aria-label="Record JSON"
          rows={4}
          style={TEXTAREA_STYLE}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <div>
        <button type="button" className="chrome-button" onClick={onImport}>
          Import record
        </button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Transport — step / play-pause / scrub / speed.
// ---------------------------------------------------------------------------

interface TransportProps {
  current: number;
  lastIndex: number;
  playing: boolean;
  speed: number;
  reducedMotion: boolean;
  onStepBack: () => void;
  onStepForward: () => void;
  onTogglePlay: () => void;
  onScrub: (value: number) => void;
  onSpeed: (value: number) => void;
}

function Transport({
  current,
  lastIndex,
  playing,
  speed,
  reducedMotion,
  onStepBack,
  onStepForward,
  onTogglePlay,
  onScrub,
  onSpeed,
}: TransportProps) {
  return (
    <div style={TRANSPORT_STYLE}>
      <div style={CONTROL_ROW_STYLE}>
        <button type="button" className="chrome-button" aria-label="Step back" onClick={onStepBack} disabled={current <= 0}>
          ‹ Back
        </button>
        <button type="button" className="chrome-button brass-accent" aria-label={playing ? "Pause" : "Play"} onClick={onTogglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="chrome-button" aria-label="Step forward" onClick={onStepForward} disabled={current >= lastIndex}>
          Forward ›
        </button>

        <span className="mono" data-testid="frame-readout" style={READOUT_STYLE}>
          <span data-testid="frame-position">{current}</span>
          {" / "}
          <span data-testid="frame-total">{lastIndex}</span>
        </span>

        <label style={SPEED_STYLE}>
          <span className="mono">Speed</span>
          <select
            className="chrome-button mono"
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => onSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>

        {reducedMotion && (
          <span className="mono" style={{ fontSize: "0.7rem", color: "var(--color-ink-700)" }}>
            reduced motion
          </span>
        )}
      </div>

      <Slider.Root
        className="ij-slider-root"
        style={SLIDER_ROOT_STYLE}
        min={0}
        max={lastIndex}
        step={1}
        value={[current]}
        onValueChange={([v]) => onScrub(v!)}
        aria-label="Scrub timeline"
      >
        <Slider.Track style={SLIDER_TRACK_STYLE}>
          <Slider.Range style={SLIDER_RANGE_STYLE} />
        </Slider.Track>
        <Slider.Thumb style={SLIDER_THUMB_STYLE} aria-label="Scrub timeline" />
      </Slider.Root>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — geometry only; colors reference tokens (no raw hex), matching the shell idiom.
// ---------------------------------------------------------------------------

const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  padding: "1rem",
};
const CLUSTER_STYLE: React.CSSProperties = {
  border: "1px solid var(--hairline)",
  padding: "0.5rem 0.75rem 0.75rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  margin: 0,
};
const LEGEND_STYLE: React.CSSProperties = {
  padding: "0 0.4rem",
  fontSize: "0.75rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--accent)",
};
const FORM_ROW_STYLE: React.CSSProperties = { display: "flex", gap: "1rem", flexWrap: "wrap" };
const FIELD_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.25rem" };
const NUMBER_INPUT_STYLE: React.CSSProperties = {
  width: "8rem",
  background: "var(--surface-app)",
  color: "var(--text-on-chrome)",
  border: "1px solid var(--hairline)",
  padding: "0.15rem 0.4rem",
};
const TEXTAREA_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: "16rem",
  background: "var(--surface-app)",
  color: "var(--text-on-chrome)",
  border: "1px solid var(--hairline)",
  padding: "0.4rem",
  resize: "vertical",
};
const STAGE_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.75rem" };
const BOARD_WRAP_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: "48rem",
  aspectRatio: "4 / 3",
  alignSelf: "center",
};
const TRANSPORT_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.5rem" };
const CONTROL_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexWrap: "wrap",
};
const READOUT_STYLE: React.CSSProperties = { fontSize: "0.85rem" };
const SPEED_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.4rem" };
const ERROR_STYLE: React.CSSProperties = {
  margin: 0,
  paddingLeft: "1rem",
  fontSize: "0.8rem",
  color: "var(--color-oxide)",
};
const SLIDER_ROOT_STYLE: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  width: "100%",
  height: "1.25rem",
  touchAction: "none",
  userSelect: "none",
};
const SLIDER_TRACK_STYLE: React.CSSProperties = {
  position: "relative",
  flex: 1,
  height: "2px",
  background: "var(--hairline)",
};
const SLIDER_RANGE_STYLE: React.CSSProperties = {
  position: "absolute",
  height: "100%",
  background: "var(--accent)",
};
const SLIDER_THUMB_STYLE: React.CSSProperties = {
  display: "block",
  width: "0.7rem",
  height: "0.7rem",
  background: "var(--accent)",
  border: "1px solid var(--color-ink-900)",
};
