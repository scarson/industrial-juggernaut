// ABOUTME: The build composer — piece-type toggle (factory | base), a mono budget meter, the
// ABOUTME: bootstrap explanation, staged pieces with optimistic preview, and the Commit action.
import { useState } from "react";
import { isBootstrapOnly } from "../engine-client/barrel";
import { budgetOf } from "../engine-client/selectors";
import { highlightSets } from "../board/highlight";
import { keyToHex } from "../board/projection";
import { previewCommand } from "./preview";
import { ComposerPanel, RuleLine, HexButtonList } from "./shell";
import type { HexButtonItem } from "./shell";
import type { GameState, PlayerId, Piece, PieceKind, Hex } from "../engine-client/barrel";
import type { GameDriver } from "../game/driver";
import type { GameStore } from "../game/store";

export interface BuildComposerProps {
  /** The authoritative state to build against. */
  readonly state: GameState;
  /** The acting player — the seat whose build this is. Callers gate mounting on
   *  `currentPlayer(state) === player` and `player` being one of `driver.controllableSeats()`. */
  readonly player: PlayerId;
  /** Submits the eventual `{type:"build", pieces}` command. */
  readonly driver: GameDriver;
  /** Read/write access for the optimistic preview (`setPreview`/`clearPreview`). */
  readonly store: GameStore;
}

/**
 * Piece-type commit + budget meter + staged pieces + Commit. Hex selection here is a
 * highlighted-hex-button list (`data-testid="build-hex-<key>"`), NOT the SVG board — routing a
 * real `Board` click into this composer's `stagePiece` is P3.11's job (the game screen owns
 * board↔composer wiring); this composer's own responsibility stops at piece-type + staged
 * pieces + budget + preview + commit, exactly per the P3.4 spec.
 */
export function BuildComposer({ state, player, driver, store }: BuildComposerProps) {
  const [pieceType, setPieceType] = useState<PieceKind>("factory");
  const [pieces, setPieces] = useState<Piece[]>([]);

  const budget = budgetOf(state, player);
  const remaining = budget - pieces.length;
  const bootstrap = isBootstrapOnly(state, player);
  const legalHexes = highlightSets(state).buildHexes;

  function stagePiece(hex: Hex) {
    if (remaining <= 0) return;
    const nextPieces = [...pieces, { type: pieceType, hex }];
    setPieces(nextPieces);
    const preview = previewCommand(state, player, { type: "build", pieces: nextPieces });
    store.getState().setPreview({ type: "build", pieces: nextPieces }, preview);
  }

  function handleCommit() {
    if (pieces.length === 0) return;
    driver.submit({ type: "build", pieces });
    setPieces([]);
    store.getState().clearPreview();
  }

  const hexItems: HexButtonItem[] = [...legalHexes].map((key) => ({
    key,
    hex: keyToHex(key),
    disabled: remaining <= 0,
  }));

  return (
    <ComposerPanel ariaLabel="Build">
      <div style={HEAD_ROW_STYLE}>
        <span className="mono" data-testid="build-budget">
          Remaining: {remaining}
        </span>
      </div>

      <fieldset aria-label="Piece type" style={FIELDSET_STYLE}>
        <label style={RADIO_LABEL_STYLE}>
          <input
            type="radio"
            name="piece-type"
            value="factory"
            checked={pieceType === "factory"}
            onChange={() => setPieceType("factory")}
          />
          <span>Factory</span>
        </label>
        <label style={RADIO_LABEL_STYLE}>
          <input
            type="radio"
            name="piece-type"
            value="base"
            checked={pieceType === "base"}
            disabled={bootstrap}
            onChange={() => setPieceType("base")}
          />
          <span>Base</span>
        </label>
      </fieldset>

      {bootstrap && <RuleLine>First build must be a factory.</RuleLine>}

      <HexButtonList
        ariaLabel="Legal build hexes"
        testIdPrefix="build-hex"
        items={hexItems}
        onSelect={stagePiece}
      />

      <div>
        <button
          type="button"
          className="chrome-button brass-accent-bg"
          disabled={pieces.length === 0}
          onClick={handleCommit}
        >
          Commit
        </button>
      </div>
    </ComposerPanel>
  );
}

const HEAD_ROW_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.5rem" };
const FIELDSET_STYLE: React.CSSProperties = {
  border: "1px solid var(--hairline)",
  padding: "0.5rem 0.75rem",
  display: "flex",
  gap: "1rem",
  margin: 0,
};
const RADIO_LABEL_STYLE: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.4rem" };
