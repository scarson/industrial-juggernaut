// ABOUTME: DEV-ONLY smoke page for the board renderer — a real mid-game 6-player state with a
// ABOUTME: fatigued base, a stranded mark, and a build-highlight set. Replaced by P2's real viewer.
import { useMemo } from "react";
import { Board } from "../Board";
import { hexKey } from "../projection";
import { devMidGameState, firstNBaseKeys, withFatiguedBase } from "./devState";
import type { HighlightSets } from "../highlight";

/**
 * Renders the Board against a deterministic mid-game state so the landmass, all six player
 * identities, factories, iron, the fatigued variant, the stranded mark, and a highlight set can
 * be eyeballed at real scale. This is a scratch page — no product route links to it.
 */
export function DevBoardPage() {
  const { state, highlights, strandedHexes } = useMemo(() => {
    const base = devMidGameState();
    const state = withFatiguedBase(base, 0);
    // A build-highlight set over a handful of empty hexes near the board center.
    const empty = state.board.hexes.filter(
      (h) => !state.bases.some((b) => hexKey(b.hex) === hexKey(h)),
    );
    const highlights: HighlightSets = {
      buildHexes: new Set(empty.slice(0, 6).map(hexKey)),
      attackTargets: new Set(empty.slice(6, 9).map(hexKey)),
      placementHexes: new Set<string>(),
    };
    const strandedHexes = firstNBaseKeys(state, 1);
    return { state, highlights, strandedHexes };
  }, []);

  return (
    <section className="table-surface" style={{ padding: "1rem", minHeight: "100vh" }}>
      <h1 style={{ marginTop: 0 }}>DEV — Board smoke</h1>
      <p style={{ maxWidth: "60ch" }}>
        Deterministic mid-game state (6 players, seed 7). Base 0 is forced fatigued and stranded;
        six hexes carry a build highlight and three an attack highlight. Not a product route.
      </p>
      <div
        style={{
          width: "min(90vw, 1000px)",
          aspectRatio: "1 / 1",
          margin: "0 auto",
        }}
      >
        <Board state={state} highlights={highlights} strandedHexes={strandedHexes} />
      </div>
    </section>
  );
}
