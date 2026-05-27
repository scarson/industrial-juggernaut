// ABOUTME: Shared console formatters for the runnable sweep scripts (main.ts, calibrate.ts).
// ABOUTME: Pure string builders — config one-liners, a metrics one-liner, and an elapsed-seconds heartbeat.

import type { RuleConfig } from "../engine/config";
import type { SweepMetrics } from "./metrics";

/** The geometry fields most runs vary, as a `field=value` one-liner. */
export function fmtConfig(c: RuleConfig): string {
  return `boardSize=${c.boardSize}, radius=${c.radius}, ironCount=${c.ironCount}, victoryThreshold=${c.victoryThreshold}`;
}

/** Like fmtConfig plus the OFAT-varied balance knobs, so an OFAT line shows exactly which knob is set to what. */
export function fmtConfigFull(c: RuleConfig): string {
  return `${fmtConfig(c)}, autoWinAt6=${c.autoWinAt6}, killBounty=${c.killBounty}, attackRange=${c.attackRange}`;
}

/** The headline health metrics as a compact one-liner. */
export function fmtMetrics(m: SweepMetrics): string {
  return `med=${m.medianTurns} cap=${m.capHitFraction.toFixed(2)} setup=${m.setupDecidedFraction.toFixed(2)} iron=${m.ironVictoryFraction.toFixed(2)} seat=${m.seatWinBias.toFixed(2)} lead=${m.leadVolatility.toFixed(2)}`;
}

/** Seconds elapsed since `t0`, as a heartbeat suffix for live progress lines. */
export function elapsedS(t0: number): string {
  return `${((Date.now() - t0) / 1000).toFixed(0)}s`;
}
