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

function isInteger(n: number): boolean {
  return Number.isInteger(n);
}

/**
 * Validates a `RuleConfig` for the designer's config panel. Ranges are the
 * client's own defense-in-depth: friendly errors up front, on top of (not a
 * replacement for) the engine's own gates at game-creation time.
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
 */
export function validateConfig(cfg: RuleConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  const positiveInteger = (knob: keyof RuleConfig, value: number, label: string) => {
    if (!isInteger(value)) {
      errors.push({ knob, message: `${label} must be an integer.` });
    } else if (value < 1) {
      errors.push({ knob, message: `${label} must be at least 1.` });
    }
  };

  positiveInteger("radius", cfg.radius, "radius");
  positiveInteger("placeRange", cfg.placeRange, "placeRange");
  positiveInteger("attackRange", cfg.attackRange, "attackRange");
  positiveInteger("baseLimit", cfg.baseLimit, "baseLimit");
  positiveInteger("factorySupply", cfg.factorySupply, "factorySupply");
  positiveInteger("ironCount", cfg.ironCount, "ironCount");
  positiveInteger("victoryThreshold", cfg.victoryThreshold, "victoryThreshold");
  positiveInteger(
    "brokenPerimeterDeathAtFactories",
    cfg.brokenPerimeterDeathAtFactories,
    "brokenPerimeterDeathAtFactories",
  );

  if (!isInteger(cfg.boardSize)) {
    errors.push({ knob: "boardSize", message: "boardSize must be an integer." });
  } else if (cfg.boardSize < 96 || cfg.boardSize > 300) {
    errors.push({
      knob: "boardSize",
      message: "boardSize must be between 96 and 300 (DER #16 oval-fit range).",
    });
  }

  if (!KILL_BOUNTY_VALUES.includes(cfg.killBounty)) {
    errors.push({
      knob: "killBounty",
      message: `killBounty must be one of: ${KILL_BOUNTY_VALUES.join(", ")}.`,
    });
  }

  const table = cfg.combatTable as Partial<Record<number, number>>;
  const missingKeys = COMBAT_TABLE_KEYS.filter((k) => table[k] === undefined);
  if (missingKeys.length > 0) {
    errors.push({
      knob: "combatTable",
      message: `combatTable is missing required key(s): ${missingKeys.join(", ")}.`,
    });
  } else {
    for (const k of COMBAT_TABLE_KEYS) {
      const p = table[k]!;
      if (!(p > 0 && p <= 1)) {
        errors.push({
          knob: "combatTable",
          message: `combatTable[${k}] must be a probability in (0, 1], got ${p}.`,
        });
      }
    }
    for (let i = 1; i < COMBAT_TABLE_KEYS.length; i++) {
      const prevKey = COMBAT_TABLE_KEYS[i - 1]!;
      const key = COMBAT_TABLE_KEYS[i]!;
      const prev = table[prevKey]!;
      const cur = table[key]!;
      if (cur < prev) {
        errors.push({
          knob: "combatTable",
          message: `combatTable must be non-decreasing in attacker count: [${prevKey}]=${prev} > [${key}]=${cur}.`,
        });
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
