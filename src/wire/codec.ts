// ABOUTME: Wire codecs — GameState/pending ↔ JSON-safe forms (rngState bigints via the rng codec).
// ABOUTME: All bigint conversion delegates to src/rng/codec (BigInt(), never Number()); spec §3/§7.
import { encodeRng, decodeRng } from "../rng/codec";
import type { GameState } from "../engine/types";
import type { EncodedState, EncodedPending } from "./protocol";

export function encodeState(s: GameState): EncodedState {
  const { rngState, ...game } = s;
  return { game, rngState: encodeRng(rngState) };
}

export function decodeState(e: EncodedState): GameState {
  return { ...e.game, rngState: decodeRng(e.rngState) };
}

// encodePending/decodePending: the wire `EncodedPending` is already JSON-safe (no bigints —
// the proposed decl's rngBeforeApply lives in STORAGE, not on the wire prompt). These are
// identity-shaped passthroughs that exist for a single typed seam + future evolution.
export function encodePending(p: EncodedPending): EncodedPending { return p; }
export function decodePending(e: EncodedPending): EncodedPending { return e; }
