// ABOUTME: RuleConfig knob grouping, validation, and default/tuned provenance for the
// ABOUTME: designer instrument's new-game config panel. Pure — no React, no I/O.
import { defaultConfig } from "../engine-client/barrel";
import type { RuleConfig } from "../engine-client/barrel";

/**
 * `RuleConfig` keys grouped for the designer's config panel. The exhaustiveness
 * test (`config-form.test.ts`) asserts the flattened union of every group equals
 * `Object.keys(defaultConfig())` — a future engine knob that isn't added to a
 * group here fails that test rather than silently going unrendered.
 */
export function configGroups(): Record<string, (keyof RuleConfig)[]> {
  return {
    Board: ["boardSize", "ironCount", "radius"],
    Economy: ["factorySupply", "baseLimit", "placeRange", "killBounty"],
    Combat: ["attackRange", "combatTable"],
    Victory: ["victoryThreshold", "brokenPerimeterDeathAtFactories", "autoWinAt6"],
    Liveness: ["allowPass"],
  };
}

export interface ConfigError {
  knob: string;
  message: string;
}

const KILL_BOUNTY_VALUES = ["full", "half", "none"] as const;
const COMBAT_TABLE_KEYS = [3, 4, 5, 6] as const;

/**
 * `boardSize` request range, per DER #16 (`docs/superpowers/specs/
 * 2026-06-12-web-client-design.md` §Digital Edition Rulings) — see the
 * `boardSize` bullet on `validateConfig` below for the full rationale.
 * Exported so other designer instruments (e.g. `board-source.ts`'s
 * `generate`-kind validation) share this range instead of duplicating it.
 */
export const BOARD_SIZE_RANGE = { min: 96, max: 300 } as const;

/**
 * `ironCount` floor — see the `ironCount` bullet on `validateConfig` below
 * for why there's no static upper bound. Exported for reuse by
 * `board-source.ts`'s `generate`-kind validation.
 */
export const IRON_COUNT_MIN = 1;

/**
 * Integer check shared by the designer's validators (`validateConfig` here,
 * `board-source.ts`'s generate-kind field validation).
 */
export function isInteger(n: number): boolean {
  return Number.isInteger(n);
}

/**
 * Renderer-facing metadata for one `RuleConfig` knob: which widget the config
 * panel renders (`type`), a short human label, and the knob's constraints.
 * `min`/`max`/`options`/`rows` are the SAME values `validateConfig` enforces —
 * both read the shared `KNOBS` record, so descriptor and validation can't
 * drift apart.
 */
export type KnobDescriptor =
  | { type: "int"; label: string; min: number; max?: number }
  | { type: "bool"; label: string }
  | { type: "enum"; label: string; options: readonly string[] }
  | { type: "table"; label: string; rows: readonly number[] };

/**
 * Single source of truth for per-knob metadata, driving BOTH `validateConfig`
 * (integer ranges, enum membership, required table rows) and `knobDescriptor`
 * (form rendering). The `Record<keyof RuleConfig, …>` type plus the
 * exhaustiveness test in `config-form.test.ts` guarantee every engine knob is
 * described here. Range rationale lives on `validateConfig`'s docblock below.
 */
const KNOBS: Record<keyof RuleConfig, KnobDescriptor> = {
  boardSize: {
    type: "int",
    label: "Board size",
    min: BOARD_SIZE_RANGE.min,
    max: BOARD_SIZE_RANGE.max,
  },
  ironCount: { type: "int", label: "Iron deposits", min: IRON_COUNT_MIN },
  radius: { type: "int", label: "Control radius", min: 1 },
  placeRange: { type: "int", label: "Placement range", min: 1 },
  attackRange: { type: "int", label: "Attack range", min: 1 },
  baseLimit: { type: "int", label: "Starting bases", min: 1 },
  factorySupply: { type: "int", label: "Factory supply", min: 1 },
  victoryThreshold: { type: "int", label: "Iron hexes to win", min: 1 },
  brokenPerimeterDeathAtFactories: {
    type: "int",
    label: "Broken-perimeter death threshold",
    min: 1,
  },
  killBounty: { type: "enum", label: "Kill bounty", options: KILL_BOUNTY_VALUES },
  combatTable: { type: "table", label: "Combat odds table", rows: COMBAT_TABLE_KEYS },
  autoWinAt6: { type: "bool", label: "Auto-win at 6 attackers" },
  allowPass: { type: "bool", label: "Allow passing" },
};

/**
 * Per-knob descriptor for the designer's config panel: widget type, human
 * label, and the same constraints `validateConfig` enforces (both read the
 * shared `KNOBS` record).
 */
export function knobDescriptor(name: keyof RuleConfig): KnobDescriptor {
  return KNOBS[name];
}

// Editorial suffix for a between-min-and-max range error, keyed by knob. Copy only —
// the range VALUES live in KNOBS. boardSize's note points at the DER #16 request-size
// rationale documented on validateConfig below.
const RANGE_NOTES: Partial<Record<keyof RuleConfig, string>> = {
  boardSize: "DER #16 oval-fit range",
};

/**
 * Validates a `RuleConfig` for the designer's config panel. Ranges are the
 * client's own defense-in-depth: friendly errors up front, on top of (not a
 * replacement for) the engine's own gates at game-creation time. All numeric
 * ranges, enum options, and required table rows come from `KNOBS` above.
 *
 * - `radius`, `placeRange`, `attackRange`, `baseLimit`, `factorySupply`,
 *   `victoryThreshold`, `brokenPerimeterDeathAtFactories` — integers ≥ 1.
 *   Every one of these is a count or a distance the engine treats as a
 *   positive whole number; 0 or negative values (or fractions) don't
 *   correspond to any legal game state.
 * - `ironCount` — integer ≥ 1 (a game needs at least one iron hex for a
 *   perimeter to be non-fatal). No static upper bound is enforced here: the
 *   real feasibility ceiling depends on `boardSize` and board shape, and is
 *   already enforced at game-creation time by the iron-placement CSP
 *   (`src/board/iron-csp.ts`), which throws after `MAX_RESTARTS = 1000`
 *   attempts when `count` can't be placed on the generated board. Duplicating
 *   that feasibility check here would require re-deriving the CSP's board-shape
 *   math and would drift the moment the CSP's tolerance changes — the CSP stays
 *   the single source of truth for "is this ironCount actually placeable."
 * - `boardSize` — integer in [96, 300]. Per DER #16 (`docs/superpowers/specs/
 *   2026-06-12-web-client-design.md` §Digital Edition Rulings), a `boardSize`
 *   request feeds `generateBoard`'s oval-fit sizing and yields an actual hex
 *   count within roughly ±6 of the request, not the input verbatim — so this
 *   range is deliberately a request-size range, not a promise of exact hex
 *   count. 96 is the engine's own default/floor; 300 is the spec's stated
 *   upper bound for comfortable SVG rendering (design spec §4).
 * - `killBounty` — must be one of the engine's `KillBounty` string enum
 *   values (`"full" | "half" | "none"`); anything else can't be threaded
 *   through `bountyCount()` (`src/engine/status.ts`).
 * - `combatTable` — must have all four keys (3, 4, 5, 6 attackers), each a
 *   probability in (0, 1] (0 would mean an attack can never win, which the
 *   engine's combat resolution doesn't model as a valid state; >1 isn't a
 *   probability), and non-decreasing as attacker count rises (more attackers
 *   must never make winning less likely — a monotonicity property of the
 *   velvet-bag draw the config is meant to tune, not invert).
 * - `autoWinAt6`, `allowPass` — booleans; no range to validate.
 *
 * Error copy register (a deliberate two-register choice): knob/field-level
 * errors — here and in `board-source.ts`'s field validation — are
 * terse-technical ("`<knob>` must be …") because the offending input sits
 * right next to the message in the form. Parse-level errors
 * (`board-source.ts`'s `JSON.parse` failure) may add an actionable hint
 * ("check for a stray comma or bracket") because an unparseable paste gives
 * the user nothing else to go on.
 */
export function validateConfig(cfg: RuleConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  for (const knob of Object.keys(KNOBS) as (keyof RuleConfig)[]) {
    const desc = KNOBS[knob];
    switch (desc.type) {
      case "int": {
        const value = cfg[knob] as number;
        if (!isInteger(value)) {
          errors.push({ knob, message: `${knob} must be an integer.` });
        } else if (desc.max !== undefined) {
          if (value < desc.min || value > desc.max) {
            const note = RANGE_NOTES[knob];
            errors.push({
              knob,
              message: `${knob} must be between ${desc.min} and ${desc.max}${note ? ` (${note})` : ""}.`,
            });
          }
        } else if (value < desc.min) {
          errors.push({ knob, message: `${knob} must be at least ${desc.min}.` });
        }
        break;
      }
      case "bool":
        break;
      case "enum": {
        const value = cfg[knob] as string;
        if (!desc.options.includes(value)) {
          errors.push({
            knob,
            message: `${knob} must be one of: ${desc.options.join(", ")}.`,
          });
        }
        break;
      }
      case "table": {
        const table = cfg[knob] as Partial<Record<number, number>>;
        const missingKeys = desc.rows.filter((k) => table[k] === undefined);
        if (missingKeys.length > 0) {
          errors.push({
            knob,
            message: `${knob} is missing required key(s): ${missingKeys.join(", ")}.`,
          });
          break;
        }
        for (const k of desc.rows) {
          const p = table[k]!;
          if (!(p > 0 && p <= 1)) {
            errors.push({
              knob,
              message: `${knob}[${k}] must be a probability in (0, 1], got ${p}.`,
            });
          }
        }
        for (let i = 1; i < desc.rows.length; i++) {
          const prevKey = desc.rows[i - 1]!;
          const key = desc.rows[i]!;
          const prev = table[prevKey]!;
          const cur = table[key]!;
          if (cur < prev) {
            errors.push({
              knob,
              message: `${knob} must be non-decreasing in attacker count: [${prevKey}]=${prev} > [${key}]=${cur}.`,
            });
          }
        }
        break;
      }
    }
  }

  return errors;
}

export type Provenance = "default" | "tuned";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Marks each `RuleConfig` knob `"default"` or `"tuned"` by deep-comparing
 * against `defaultConfig()`. Drives the designer panel's default-vs-hand-tuned
 * badge (design spec's "provenance" requirement).
 */
export function provenance(cfg: RuleConfig): Record<keyof RuleConfig, Provenance> {
  const base = defaultConfig();
  const result = {} as Record<keyof RuleConfig, Provenance>;
  for (const key of Object.keys(base) as (keyof RuleConfig)[]) {
    result[key] = deepEqual(cfg[key], base[key]) ? "default" : "tuned";
  }
  return result;
}
