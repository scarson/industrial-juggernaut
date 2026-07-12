// ABOUTME: The build composer — piece-type toggle (factory | base), a mono budget meter, the
// ABOUTME: bootstrap explanation, staged pieces with optimistic preview, and the Commit action.
import { useEffect, useRef, useState } from "react";
import { isBootstrapOnly } from "../engine-client/barrel";
import { budgetOf } from "../engine-client/selectors";
import { highlightSets } from "../board/highlight";
import { hexKey, keyToHex } from "../board/projection";
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
 * Piece-type commit + budget meter + staged pieces + Commit. Hex selection is the
 * highlighted-hex-button list (`data-testid="build-hex-<key>"`) — the keyboard/a11y action path —
 * plus the SVG board via the `build` board-click channel (PlayView routes clicks on highlighted
 * cells here). Both offer the piece-type-specific legal set, and staged pieces publish to
 * `ui.stagedBuild` so the board renders them as the brass selection.
 */
export function BuildComposer({ state, player, driver, store }: BuildComposerProps) {
  const [pieceType, setPieceType] = useState<PieceKind>("factory");
  const [pieces, setPieces] = useState<Piece[]>([]);

  const budget = budgetOf(state, player);
  const remaining = budget - pieces.length;
  const bootstrap = isBootstrapOnly(state, player);
  const sets = highlightSets(state);
  // The chip list and board clicks offer the PIECE-TYPE-SPECIFIC legal set, not the union — a
  // base-only hex (iron) offered in factory mode is a click the engine can only reject.
  const legalHexes = pieceType === "factory" ? sets.factoryHexes : sets.baseHexes;

  function stagePiece(hex: Hex, type: PieceKind) {
    if (remaining <= 0) return;
    const nextPieces = [...pieces, { type, hex }];
    setPieces(nextPieces);
    const preview = previewCommand(state, player, { type: "build", pieces: nextPieces });
    store.getState().setPreview({ type: "build", pieces: nextPieces }, preview);
    store.getState().setStagedBuild(nextPieces.map((p) => p.hex));
  }

  // A build places ONE piece type (the engine rejects mixes as MIXED_PIECE_TYPES), so switching
  // the type restarts staging — staged pieces of the old type can never ride into the new one.
  function selectPieceType(type: PieceKind) {
    if (type === pieceType) return;
    setPieceType(type);
    if (pieces.length > 0) {
      setPieces([]);
      store.getState().clearPreview();
      store.getState().setStagedBuild([]);
    }
  }

  function handleCommit() {
    if (pieces.length === 0) return;
    driver.submit({ type: "build", pieces });
    setPieces([]);
    store.getState().clearPreview();
    store.getState().setStagedBuild([]);
  }

  // A board click stages at the clicked hex: with the selected type when legal there; otherwise —
  // only while nothing is staged yet (one type per build) — by auto-switching to the OTHER type
  // when the hex is legal only for it (e.g. clicking iron in factory mode stages a base). A hex
  // legal for neither is a no-op; PlayView routes only highlighted cells here anyway.
  function handleBoardClick(hex: Hex) {
    const key = hexKey(hex);
    if (legalHexes.has(key)) {
      stagePiece(hex, pieceType);
      return;
    }
    if (pieces.length > 0 || bootstrap) return;
    const other: PieceKind = pieceType === "factory" ? "base" : "factory";
    const otherSet = other === "factory" ? sets.factoryHexes : sets.baseHexes;
    if (otherSet.has(key)) {
      setPieceType(other);
      stagePiece(hex, other);
    }
  }

  // Board-click seam: claim the `build` board channel while mounted. The handler closes over the
  // live staging state via a ref (re-registering on every staging change would thrash the store);
  // unmount releases the channel and clears the staged publication so the board's brass selection
  // never outlives the composer that staged it.
  const boardClickRef = useRef(handleBoardClick);
  boardClickRef.current = handleBoardClick;
  useEffect(() => {
    store.getState().setBoardHandler("build", (hex: Hex) => boardClickRef.current(hex));
    return () => {
      store.getState().setBoardHandler("build", null);
      store.getState().setStagedBuild([]);
    };
  }, [store]);

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
            onChange={() => selectPieceType("factory")}
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
            onChange={() => selectPieceType("base")}
          />
          <span>Base</span>
        </label>
      </fieldset>

      {bootstrap && <RuleLine>First build must be a factory.</RuleLine>}

      <HexButtonList
        ariaLabel="Legal build hexes"
        testIdPrefix="build-hex"
        items={hexItems}
        onSelect={(hex) => stagePiece(hex, pieceType)}
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
