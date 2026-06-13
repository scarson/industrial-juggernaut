// ABOUTME: stateHash — a deterministic, structural, order-independent checksum of GameState (spec §3 divergence guard).
// ABOUTME: Canonicalizes bases/factories/players/phase/factorySupply/rngState (bigints via toString), then FNV-1a.

import { key } from "../geometry/cube";
import type { GameState } from "../engine/types";

/** Canonical, order-independent serialization of the divergence-relevant state. */
function canonicalize(s: GameState): string {
  const bases = s.bases
    .map((b) => `${b.owner}@${key(b.hex)}:${b.state}:${b.order}`)
    .sort()
    .join("|");
  const factories = s.factories.map((f) => key(f.hex)).sort().join("|");
  const players = [...s.players]
    .sort((a, b) => a.id - b.id)
    .map((p) => `${p.id}:${p.basesInHand}:${p.eliminated ? 1 : 0}:[${[...p.alliance].sort((x, y) => x - y).join(",")}]`)
    .join("|");
  const phase = `${s.phase.turn}/${s.phase.indexInOrder}/[${s.phase.order.join(",")}]`;
  const rng = `${s.rngState.state.toString()}:${s.rngState.inc.toString()}`;
  // board + config are header-fixed for a session; excluded — divergence is about evolving state.
  return `B:${bases};F:${factories};P:${players};PH:${phase};FS:${s.factorySupply};R:${rng}`;
}

/** FNV-1a (64-bit) over the canonical string, returned as a hex string. */
export function stateHash(s: GameState): string {
  const str = canonicalize(s);
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ BigInt(str.charCodeAt(i))) & mask;
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, "0");
}
