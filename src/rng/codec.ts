// ABOUTME: JSON-safe encoding for the PCG32 RngState bigints (spec §3).
// ABOUTME: Decimal strings; all consumers MUST use BigInt() — never Number()/parseFloat() (precision loss > 2^53).

import type { RngState } from "./pcg";

export type EncodedRng = { state: string; inc: string };

/** RngState → JSON-safe decimal strings (JSON.stringify throws on bigint directly). */
export function encodeRng(r: RngState): EncodedRng {
  return { state: r.state.toString(), inc: r.inc.toString() };
}

/** Decimal strings → RngState. Uses BigInt(); NEVER Number() (would lose precision > 2^53). */
export function decodeRng(e: EncodedRng): RngState {
  return { state: BigInt(e.state), inc: BigInt(e.inc) };
}
