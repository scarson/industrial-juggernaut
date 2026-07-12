// ABOUTME: DEV-ONLY smoke page for the board renderer — toggles between a radiating (disks) and a
// ABOUTME: perimetered (hull + overlap) regime, with identity/fatigued/stranded demos and a hover readout.
import { useMemo, useState } from "react";
import { Board } from "../Board";
import { hexKey } from "../projection";
import { tooltipData } from "../tooltip";
import {
  devRadiatingState,
  devPerimeteredState,
  firstNBaseKeys,
  withFatiguedBase,
} from "./devState";
import type { HighlightSets } from "../highlight";
import type { GameState, Hex } from "../../engine-client/barrel";

type Regime = "radiating" | "perimetered";

// One deterministic scene per regime: the engine-driven radiating (disks) state, and the
// structurally-overridden perimetered (hull + overlap) state. Both get base 0 forced fatigued +
// stranded and a build/attack highlight set so the identity/state/highlight treatments stay
// visible alongside the territory fills.
function buildScene(regime: Regime): {
  state: GameState;
  highlights: HighlightSets;
  strandedHexes: Set<string>;
} {
  const raw = regime === "radiating" ? devRadiatingState() : devPerimeteredState();
  const state = withFatiguedBase(raw, 0);
  const empty = state.board.hexes.filter(
    (h) => !state.bases.some((b) => hexKey(b.hex) === hexKey(h)),
  );
  const buildHexes = new Set(empty.slice(0, 6).map(hexKey));
  const highlights: HighlightSets = {
    buildHexes,
    // The dev page's demo highlights are hand-picked empty hexes — treat them all as
    // factory-legal for the piece-typed sets (the demo exercises rendering, not legality).
    factoryHexes: buildHexes,
    baseHexes: new Set<string>(),
    attackTargets: new Set(empty.slice(6, 9).map(hexKey)),
    placementHexes: new Set<string>(),
  };
  const strandedHexes = firstNBaseKeys(state, 1);
  return { state, highlights, strandedHexes };
}

/**
 * Renders the Board against two deterministic scenes selectable via a toggle: a radiating early
 * game (every player under 4 bases — territory reads as radius disks) and a later perimetered game
 * (player 0 holds a 4-base hull, with contested overlap where player 1's disks reach in). Each scene
 * also carries the fatigued/stranded/highlight demos. A hover readout wires onHexHover through
 * tooltipData so the P1.6 data path (control / iron / occupant) is browser-visible. Scratch page —
 * no product route links here.
 */
export function DevBoardPage() {
  const [regime, setRegime] = useState<Regime>("radiating");
  const [hovered, setHovered] = useState<Hex | null>(null);

  const { state, highlights, strandedHexes } = useMemo(() => buildScene(regime), [regime]);

  const readout = hovered === null ? null : tooltipData(state, hovered);

  return (
    <section className="table-surface" style={{ padding: "1rem", minHeight: "100vh" }}>
      <h1 style={{ marginTop: 0 }}>DEV — Board smoke</h1>
      <p style={{ maxWidth: "70ch" }}>
        Two deterministic scenes (seed 7). <strong>Radiating</strong>: 6 players early, every player
        under 4 bases, so territory reads as radius disks with contested overlap. <strong>Perimetered</strong>:
        player 0 holds a 4-base hull (perimeter regime) with player 1&apos;s disks contesting its
        eastern edge. Base 0 is forced fatigued + stranded; a build/attack highlight set rides the
        strokes. Not a product route.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <button
          type="button"
          className="chrome-button"
          aria-pressed={regime === "radiating"}
          data-regime-button="radiating"
          onClick={() => setRegime("radiating")}
          style={regime === "radiating" ? { outline: "2px solid currentColor" } : undefined}
        >
          Radiating (disks)
        </button>
        <button
          type="button"
          className="chrome-button"
          aria-pressed={regime === "perimetered"}
          data-regime-button="perimetered"
          onClick={() => setRegime("perimetered")}
          style={regime === "perimetered" ? { outline: "2px solid currentColor" } : undefined}
        >
          Perimetered (hull + overlap)
        </button>
      </div>

      <p className="mono" data-hover-readout style={{ minHeight: "1.4em", margin: "0 0 0.75rem" }}>
        {readout === null
          ? "hover a hex —"
          : `hex ${hexKey(hovered!)}  ·  control ${readout.controlledBy ?? "—"}  ·  iron ${
              readout.isIron ? "yes" : "no"
            }  ·  occupant ${readout.occupant ?? "—"}`}
      </p>

      <div
        style={{
          width: "min(90vw, 1000px)",
          aspectRatio: "1 / 1",
          margin: "0 auto",
        }}
      >
        <Board
          state={state}
          highlights={highlights}
          strandedHexes={strandedHexes}
          onHexHover={setHovered}
        />
      </div>
    </section>
  );
}
