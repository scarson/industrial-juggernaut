// ABOUTME: Named RuleConfig presets for the designer's new-game form, with the
// ABOUTME: single-source swap point for adopting a future balance-sweep-derived config.
import { defaultConfig } from "../engine-client/barrel";
import type { RuleConfig } from "../engine-client/barrel";

/**
 * Balance-sweep track status, surfaced by the designer so players know the shipped
 * numbers aren't final. Single-sourced here so the copy can't drift between call sites.
 */
export const BALANCE_IN_PROGRESS_NOTE =
  "Balance is under active development — these numbers will change as playtesting continues.";

/**
 * `current-playtest-config`'s value is `defaultConfig()` today. This is the one-line
 * swap point for adopting a balance-sweep-derived config once the sweep track produces
 * one: replace the right-hand side below with the tuned `RuleConfig` literal (Sam-gated —
 * do not swap without explicit approval). Every other preset key stays untouched.
 */
const PRESETS = {
  "current-playtest-config": defaultConfig(),
} satisfies Record<string, RuleConfig>;

export type PresetName = keyof typeof PRESETS;

/**
 * All named presets, keyed by `PresetName`. Values are the live source of truth —
 * callers must not mutate them directly; use `applyPreset` for a safe-to-mutate copy.
 */
export function presets(): Record<PresetName, RuleConfig> {
  return PRESETS;
}

function deepClone(cfg: RuleConfig): RuleConfig {
  return {
    ...cfg,
    combatTable: { ...cfg.combatTable },
  };
}

/**
 * Looks up a preset by name and returns a fresh deep copy, safe for the designer
 * form to mutate as working state without aliasing the stored preset.
 */
export function applyPreset(name: PresetName): RuleConfig {
  const cfg = PRESETS[name];
  if (!cfg) {
    throw new Error(`Unknown preset: "${name}".`);
  }
  return deepClone(cfg);
}
