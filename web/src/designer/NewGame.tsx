// ABOUTME: The designer's new-game instrument — preset → grouped knob clusters → board-source picker →
// ABOUTME: seat roster → seed → the balance note → the one brass Start. Assembles a SessionHeader via onStart.
import { useMemo, useReducer, useState } from "react";
import * as Slider from "@radix-ui/react-slider";
import {
  configGroups,
  knobDescriptor,
  provenance,
  validateConfig,
  type ConfigError,
  type Provenance,
} from "./config-form";
import { parseBoardSource, type BoardSourceValidation } from "./board-source";
import { applyPreset, presets, BALANCE_IN_PROGRESS_NOTE, type PresetName } from "./presets";
import {
  GREEDY_ARCHETYPES,
  MAX_SEATS,
  MIN_SEATS,
  assembleHeader,
  initialSeats,
  parseSeed,
  seatKindOf,
  seatsReducer,
  type SeatAction,
} from "./new-game-form";
import { defaultConfig } from "../engine-client/barrel";
import type { RuleConfig, SeatConfig, SessionHeader, PlayerId } from "../engine-client/barrel";
// Type-only (erased): Archetype for the seat picker's typing. The runtime option list is
// GREEDY_ARCHETYPES (declared in new-game-form.ts) — src/agent never enters the value graph.
import type { Archetype } from "../../../src/agent/archetypes";
import { playerIdentity } from "../identity/player-identity";
import { PlayerShapeIcon } from "../identity/shapes";

export interface NewGameProps {
  /** Receives the assembled, decoded `SessionHeader` (bigint seed) when the designer starts a game. */
  readonly onStart: (header: SessionHeader) => void;
  /** Fork entry point (UI brief §7): pre-fills the knobs from a running game's config. */
  readonly initialConfig?: RuleConfig;
}

const DEFAULT_SEED = "1";

/** The board-source picker's two modes: generate a fresh board, or paste a fixed one. */
type BoardMode = "generate" | "fixed";

/**
 * The new-game designer instrument. War-room lane (DESIGN.md): walnut panels, mono numbers,
 * hairline-separated knob clusters, and the ONE brass-filled Start (the Brass Budget). Emphatically
 * not a SaaS settings form — knob groups read as instrument clusters, never a card grid.
 */
export function NewGame({ onStart, initialConfig }: NewGameProps) {
  const [config, setConfig] = useState<RuleConfig>(() =>
    initialConfig ? cloneConfig(initialConfig) : defaultConfig(),
  );
  const [seats, dispatchSeats] = useReducer(seatsReducer, undefined, initialSeats);
  const [boardMode, setBoardMode] = useState<BoardMode>("generate");
  const [genSize, setGenSize] = useState(String(defaultConfig().boardSize));
  const [genIron, setGenIron] = useState(String(defaultConfig().ironCount));
  const [fixedJson, setFixedJson] = useState("");
  const [seedText, setSeedText] = useState(DEFAULT_SEED);

  const marks = useMemo(() => provenance(config), [config]);
  const configErrors = useMemo(() => validateConfig(config), [config]);
  const errorByKnob = useMemo(() => indexErrors(configErrors), [configErrors]);

  const boardInput =
    boardMode === "generate"
      ? { kind: "generate" as const, size: Number(genSize), ironCount: Number(genIron) }
      : { kind: "fixed" as const, raw: fixedJson };
  const boardResult = useMemo(() => parseBoardSource(boardInput), [boardMode, genSize, genIron, fixedJson]);

  const seedResult = useMemo(() => parseSeed(seedText), [seedText]);

  const canStart = configErrors.length === 0 && boardResult.ok && seedResult.ok;

  function handleStart() {
    if (!boardResult.ok || !seedResult.ok || configErrors.length > 0) return;
    const header: SessionHeader = assembleHeader({
      seed: seedResult.seed,
      config,
      boardSource: boardResult.source,
      seats,
    });
    onStart(header);
  }

  function setPreset(name: PresetName) {
    setConfig(applyPreset(name));
  }

  return (
    <section className="table-panel" aria-label="New game" style={PANEL_STYLE}>
      <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>New game</h1>

      <PresetRow onSelect={setPreset} />

      <div style={CLUSTER_GRID_STYLE}>
        {Object.entries(configGroups()).map(([groupName, knobs]) => (
          <KnobCluster
            key={groupName}
            name={groupName}
            knobs={knobs}
            config={config}
            marks={marks}
            errorByKnob={errorByKnob}
            onChange={setConfig}
          />
        ))}
      </div>

      <BoardSourcePicker
        mode={boardMode}
        onMode={setBoardMode}
        genSize={genSize}
        genIron={genIron}
        fixedJson={fixedJson}
        onGenSize={setGenSize}
        onGenIron={setGenIron}
        onFixedJson={setFixedJson}
        result={boardResult}
      />

      <SeatRoster seats={seats} dispatch={dispatchSeats} />

      <SeedField value={seedText} onChange={setSeedText} error={seedResult.ok ? null : seedResult.message} />

      <p className="mono" style={NOTE_STYLE} data-testid="balance-note">
        {BALANCE_IN_PROGRESS_NOTE}
      </p>

      <div>
        <button
          type="button"
          className="chrome-button brass-accent-bg"
          disabled={!canStart}
          onClick={handleStart}
        >
          Start
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Preset row
// ---------------------------------------------------------------------------

function PresetRow({ onSelect }: { onSelect: (name: PresetName) => void }) {
  const names = Object.keys(presets()) as PresetName[];
  return (
    <label style={ROW_LABEL_STYLE}>
      <span>Preset</span>
      <select
        className="chrome-button"
        aria-label="Preset"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value as PresetName);
        }}
      >
        <option value="" disabled>
          Load a preset…
        </option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Knob clusters
// ---------------------------------------------------------------------------

interface KnobClusterProps {
  name: string;
  knobs: (keyof RuleConfig)[];
  config: RuleConfig;
  marks: Record<keyof RuleConfig, Provenance>;
  errorByKnob: Map<string, string>;
  onChange: (next: RuleConfig) => void;
}

function KnobCluster({ name, knobs, config, marks, errorByKnob, onChange }: KnobClusterProps) {
  return (
    <fieldset aria-label={name} style={CLUSTER_STYLE}>
      <legend className="mono" style={LEGEND_STYLE}>
        {name}
      </legend>
      {knobs.map((knob) => (
        <KnobControl
          key={knob}
          knob={knob}
          config={config}
          provenance={marks[knob]}
          error={errorByKnob.get(knob) ?? null}
          onChange={onChange}
        />
      ))}
    </fieldset>
  );
}

interface KnobControlProps {
  knob: keyof RuleConfig;
  config: RuleConfig;
  provenance: Provenance;
  error: string | null;
  onChange: (next: RuleConfig) => void;
}

function KnobControl({ knob, config, provenance, error, onChange }: KnobControlProps) {
  const desc = knobDescriptor(knob);

  function setValue(value: RuleConfig[keyof RuleConfig]) {
    onChange({ ...config, [knob]: value });
  }

  return (
    <div data-testid={`knob-${knob}`} style={KNOB_STYLE}>
      <div style={KNOB_HEAD_STYLE}>
        <span style={{ flex: 1 }}>{desc.label}</span>
        <ProvenanceBadge provenance={provenance} />
      </div>

      {desc.type === "int" && (
        <IntKnob knob={knob} desc={desc} value={config[knob] as number} onValue={setValue} />
      )}
      {desc.type === "bool" && (
        <label style={BOOL_STYLE}>
          <input
            type="checkbox"
            checked={config[knob] as boolean}
            onChange={(e) => setValue(e.target.checked)}
          />
          <span className="mono">{(config[knob] as boolean) ? "on" : "off"}</span>
        </label>
      )}
      {desc.type === "enum" && (
        <select
          className="chrome-button mono"
          aria-label={desc.label}
          value={config[knob] as string}
          onChange={(e) => setValue(e.target.value as RuleConfig[keyof RuleConfig])}
        >
          {desc.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
      {desc.type === "table" && (
        <CombatTableReadout rows={desc.rows} table={config[knob] as Record<number, number>} />
      )}

      {error && (
        <p className="mono" role="alert" style={FIELD_ERROR_STYLE}>
          {error}
        </p>
      )}
    </div>
  );
}

interface IntKnobProps {
  knob: keyof RuleConfig;
  desc: { type: "int"; label: string; min: number; max?: number };
  value: number;
  onValue: (value: number) => void;
}

// Bounded ints (a min AND a max — today just boardSize) get a Radix slider paired with a mono
// number readout; open-ended ints get a plain mono number input. Both write the same numeric
// state, so validation and provenance treat them identically.
function IntKnob({ knob, desc, value, onValue }: IntKnobProps) {
  // Narrow to a local const so the Slider's `max` prop is `number`, not `number | undefined`
  // (exactOptionalPropertyTypes rejects the widened type on the Radix prop).
  const max = desc.max;
  return (
    <div style={INT_KNOB_STYLE}>
      {max !== undefined && (
        <Slider.Root
          className="ij-slider-root"
          style={SLIDER_ROOT_STYLE}
          min={desc.min}
          max={max}
          step={1}
          value={[value]}
          onValueChange={([v]) => onValue(v!)}
          aria-label={desc.label}
        >
          <Slider.Track style={SLIDER_TRACK_STYLE}>
            <Slider.Range style={SLIDER_RANGE_STYLE} />
          </Slider.Track>
          <Slider.Thumb style={SLIDER_THUMB_STYLE} aria-label={desc.label} />
        </Slider.Root>
      )}
      <input
        className="mono"
        type="number"
        aria-label={desc.label}
        style={NUMBER_INPUT_STYLE}
        value={Number.isNaN(value) ? "" : value}
        min={desc.min}
        max={desc.max}
        step={1}
        onChange={(e) => onValue(e.target.value === "" ? NaN : Number(e.target.value))}
        data-knob={knob}
      />
    </div>
  );
}

function CombatTableReadout({ rows, table }: { rows: readonly number[]; table: Record<number, number> }) {
  return (
    <div className="mono" style={COMBAT_TABLE_STYLE}>
      {rows.map((r) => (
        <span key={r} style={COMBAT_CELL_STYLE}>
          {r}:{formatOdds(table[r])}
        </span>
      ))}
    </div>
  );
}

function formatOdds(p: number | undefined): string {
  if (p === undefined || Number.isNaN(p)) return "—";
  return p.toFixed(2);
}

function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const tuned = provenance === "tuned";
  return (
    <span
      className="mono"
      style={{
        ...BADGE_STYLE,
        color: tuned ? "var(--accent)" : "var(--color-ink-700)",
        borderColor: tuned ? "var(--accent)" : "var(--hairline)",
      }}
    >
      {tuned ? "tuned" : "default"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Board-source picker
// ---------------------------------------------------------------------------

interface BoardSourcePickerProps {
  mode: BoardMode;
  onMode: (mode: BoardMode) => void;
  genSize: string;
  genIron: string;
  fixedJson: string;
  onGenSize: (v: string) => void;
  onGenIron: (v: string) => void;
  onFixedJson: (v: string) => void;
  result: BoardSourceValidation;
}

function BoardSourcePicker({
  mode,
  onMode,
  genSize,
  genIron,
  fixedJson,
  onGenSize,
  onGenIron,
  onFixedJson,
  result,
}: BoardSourcePickerProps) {
  const genError = (field: "size" | "ironCount"): string | null => {
    if (result.ok || result.kind !== "generate") return null;
    return result.errors.find((e) => e.field === field)?.message ?? null;
  };
  const fixedErrors = !result.ok && result.kind === "fixed" ? result.errors : [];

  return (
    <fieldset aria-label="Board source" style={CLUSTER_STYLE}>
      <legend className="mono" style={LEGEND_STYLE}>
        Board
      </legend>
      <label style={ROW_LABEL_STYLE}>
        <span>Board source</span>
        <select
          className="chrome-button mono"
          aria-label="Board source"
          value={mode}
          onChange={(e) => onMode(e.target.value as BoardMode)}
        >
          <option value="generate">generate</option>
          <option value="fixed">fixed JSON</option>
        </select>
      </label>

      {mode === "generate" ? (
        <div data-testid="board-source-generate" style={GEN_FIELDS_STYLE}>
          <label style={ROW_LABEL_STYLE}>
            <span>Size</span>
            <input
              className="mono"
              type="number"
              aria-label="Board size"
              style={NUMBER_INPUT_STYLE}
              value={genSize}
              onChange={(e) => onGenSize(e.target.value)}
            />
          </label>
          {genError("size") && (
            <p className="mono" role="alert" style={FIELD_ERROR_STYLE}>
              {genError("size")}
            </p>
          )}
          <label style={ROW_LABEL_STYLE}>
            <span>Iron deposits</span>
            <input
              className="mono"
              type="number"
              aria-label="Iron deposits"
              style={NUMBER_INPUT_STYLE}
              value={genIron}
              onChange={(e) => onGenIron(e.target.value)}
            />
          </label>
          {genError("ironCount") && (
            <p className="mono" role="alert" style={FIELD_ERROR_STYLE}>
              {genError("ironCount")}
            </p>
          )}
        </div>
      ) : (
        <div data-testid="board-source-fixed">
          <label style={{ ...ROW_LABEL_STYLE, alignItems: "flex-start" }}>
            <span>Board JSON</span>
            <textarea
              className="mono"
              aria-label="Board JSON"
              rows={6}
              style={TEXTAREA_STYLE}
              value={fixedJson}
              onChange={(e) => onFixedJson(e.target.value)}
            />
          </label>
          {fixedErrors.map((msg) => (
            <p key={msg} className="mono" role="alert" style={FIELD_ERROR_STYLE}>
              {msg}
            </p>
          ))}
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Seat roster
// ---------------------------------------------------------------------------

function SeatRoster({ seats, dispatch }: { seats: SeatConfig[]; dispatch: (a: SeatAction) => void }) {
  return (
    <fieldset aria-label="Seats" style={CLUSTER_STYLE}>
      <legend className="mono" style={LEGEND_STYLE}>
        Seats
      </legend>
      {seats.map((seat, i) => (
        <SeatRow key={i} index={i} seat={seat} canRemove={seats.length > MIN_SEATS} dispatch={dispatch} />
      ))}
      <button
        type="button"
        className="chrome-button"
        disabled={seats.length >= MAX_SEATS}
        onClick={() => dispatch({ type: "addSeat" })}
      >
        Add seat
      </button>
    </fieldset>
  );
}

interface SeatRowProps {
  index: number;
  seat: SeatConfig;
  canRemove: boolean;
  dispatch: (a: SeatAction) => void;
}

function SeatRow({ index, seat, canRemove, dispatch }: SeatRowProps) {
  const identity = playerIdentity(index as PlayerId);
  const kind = seatKindOf(seat);
  const seatLabel = `Seat ${index + 1}`;

  return (
    <div data-testid={`seat-row-${index}`} style={SEAT_ROW_STYLE}>
      <span style={SEAT_CHIP_STYLE} aria-hidden="true">
        <PlayerShapeIcon identity={identity} size={11} />
      </span>
      <span className="mono" style={{ width: "3.5rem" }}>
        {seatLabel}
      </span>
      <select
        className="chrome-button mono"
        aria-label={`${seatLabel} kind`}
        value={kind}
        onChange={(e) => dispatch({ type: "setKind", index, kind: e.target.value as ReturnType<typeof seatKindOf> })}
      >
        <option value="human">human</option>
        <option value="greedy">agent: greedy</option>
        <option value="heuristic">agent: heuristic</option>
      </select>

      {seat.kind === "agent" && seat.agent === "greedy" && (
        <select
          className="chrome-button mono"
          aria-label={`${seatLabel} archetype`}
          value={seat.archetype}
          onChange={(e) =>
            dispatch({ type: "setArchetype", index, archetype: e.target.value as Archetype })
          }
        >
          {GREEDY_ARCHETYPES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        className="chrome-button"
        aria-label={`Remove ${seatLabel}`}
        disabled={!canRemove}
        onClick={() => dispatch({ type: "removeSeat", index })}
        style={{ marginLeft: "auto" }}
      >
        Remove
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seed field
// ---------------------------------------------------------------------------

function SeedField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <fieldset aria-label="Seed" style={CLUSTER_STYLE}>
      <legend className="mono" style={LEGEND_STYLE}>
        Seed
      </legend>
      <label style={ROW_LABEL_STYLE}>
        <span>Seed</span>
        <input
          className="mono"
          type="text"
          inputMode="numeric"
          aria-label="Seed"
          style={NUMBER_INPUT_STYLE}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {error && (
        <p className="mono" role="alert" style={FIELD_ERROR_STYLE}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function indexErrors(errors: ConfigError[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of errors) {
    if (!map.has(e.knob)) map.set(e.knob, e.message);
  }
  return map;
}

function cloneConfig(cfg: RuleConfig): RuleConfig {
  return { ...cfg, combatTable: { ...cfg.combatTable } };
}

// ---------------------------------------------------------------------------
// Inline styles — the instrument's structural layout. Colors come from tokens via CSS
// variables (no raw hex); these are geometry/spacing only, matching the shell's inline-style idiom.
// ---------------------------------------------------------------------------

const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
  padding: "1rem",
  maxWidth: "72ch",
};
const CLUSTER_GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
  gap: "0.75rem",
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
const KNOB_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.25rem" };
const KNOB_HEAD_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.5rem" };
const INT_KNOB_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.5rem" };
const NUMBER_INPUT_STYLE: React.CSSProperties = {
  width: "5rem",
  background: "var(--surface-app)",
  color: "var(--text-on-chrome)",
  border: "1px solid var(--hairline)",
  padding: "0.15rem 0.4rem",
};
const BOOL_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.4rem" };
const COMBAT_TABLE_STYLE: React.CSSProperties = { display: "flex", gap: "0.6rem", flexWrap: "wrap" };
const COMBAT_CELL_STYLE: React.CSSProperties = { fontSize: "0.85rem" };
const BADGE_STYLE: React.CSSProperties = {
  fontSize: "0.65rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  border: "1px solid var(--hairline)",
  padding: "0 0.3rem",
};
const ROW_LABEL_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  justifyContent: "space-between",
};
const GEN_FIELDS_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.5rem" };
const TEXTAREA_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "var(--surface-app)",
  color: "var(--text-on-chrome)",
  border: "1px solid var(--hairline)",
  padding: "0.4rem",
  resize: "vertical",
};
const SEAT_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};
const SEAT_CHIP_STYLE: React.CSSProperties = {
  display: "inline-flex",
  width: "1.5rem",
  height: "1.5rem",
  alignItems: "center",
  justifyContent: "center",
};
const NOTE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--color-parchment-300)",
  // A hairline frame + recessed inset sets the note apart without the colored side-stripe that
  // DESIGN.md's anti-references reject (cf. the DER callout's hairline frame in RulesReference).
  border: "1px solid var(--hairline)",
  backgroundColor: "var(--surface-app)",
  padding: "0.3rem 0.55rem",
};
const FIELD_ERROR_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  color: "var(--color-oxide)",
};
const SLIDER_ROOT_STYLE: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  flex: 1,
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
