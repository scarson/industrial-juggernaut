// ABOUTME: The board renderer — one <svg> holding the parchment landmass, iron/factory glyphs, and
// ABOUTME: player-identity base tokens, with highlight/selection/stranded cell + piece treatments.
import { color } from "../design/tokens";
import { Hex, type HexHighlight } from "./Hex";
import { Base } from "./Base";
import { Factory } from "./Factory";
import { IronGlyph } from "./IronGlyph";
import { TerritoryFill } from "./TerritoryFill";
import { territoryFills } from "./territory";
import { boardViewBox, hexToPixel, hexKey } from "./projection";
import type { HighlightSets } from "./highlight";
import type { GameState, Hex as HexModel } from "../engine-client/barrel";

export type BoardProps = {
  state: GameState;
  highlights?: HighlightSets;
  /** The in-progress action composer's selection (P3 wires this; P1 just renders it). */
  selection?: { attackers?: HexModel[]; target?: HexModel; pieces?: HexModel[] };
  /** Canonical hexKeys of bases to mark stranded. */
  strandedHexes?: Set<string>;
  onHexClick?: (hex: HexModel) => void;
  onHexHover?: (hex: HexModel | null) => void;
};

// The hex circumradius in SVG user units. The board's <svg> scales to its container via the
// viewBox, so this absolute number does NOT set on-screen size — it only fixes the ratio between
// the cell and the stroke widths / glyph sizes derived from it. 12 gives comfortable headroom for
// sub-pixel-free stroke ratios (a 0.025*size hairline = 0.3u) without inflating coordinate values.
const HEX_SIZE = 12;

/**
 * Renders the whole board as a single SVG: the parchment landmass (one Hex per board hex),
 * then unowned board glyphs (iron, factories), then player base tokens on top. Highlight and
 * selection are resolved to per-cell treatments; stranded flags mark at-risk bases.
 *
 * Hit-testing is SVG-element-based (pitfall GEO-2 — no pixel->hex inverse): each Hex parses its
 * own `data-hex` on click, so this component wires no per-cell click closures.
 */
export function Board({ state, highlights, selection, strandedHexes, onHexClick, onHexHover }: BoardProps) {
  const viewBox = boardViewBox(state.board, HEX_SIZE);
  const selectedKeys = selectionKeys(selection);
  // `territoryFills` is memoized on the immutable `state` reference (GEO-5), so calling it inline
  // each render is a WeakMap hit after the first — no useMemo needed. Consuming control()'s output
  // here (never re-deriving control) keeps the renderer GEO-8-compliant.
  const fills = territoryFills(state);

  return (
    <svg
      className="board-surface"
      viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
      role="img"
      aria-label="Game board"
      style={{ width: "100%", height: "100%", display: "block", backgroundColor: color("parchment300") }}
    >
      {/* The landmass: one parchment cell per hex, each carrying its own highlight/selection. */}
      {state.board.hexes.map((hex) => {
        const key = hexKey(hex);
        return (
          <Hex
            key={key}
            hex={hex}
            center={pixelPoint(hex)}
            size={HEX_SIZE}
            highlight={highlightFor(key, highlights)}
            selected={selectedKeys.has(key)}
            onHexClick={onHexClick}
            onHexHover={onHexHover}
          />
        );
      })}

      {/* Territory washes — a translucent player-color claim over the parchment, painted after the
          landmass (so it sits on the parchment fill) but before iron/factories/bases (so the ink
          glyphs stay crisp on top). Contested hexes get a two-color split. */}
      {state.board.hexes.map((hex) => {
        const key = hexKey(hex);
        const controllers = fills.get(key);
        if (controllers === undefined) return null;
        return (
          <TerritoryFill
            key={key}
            hexKey={key}
            controllers={controllers}
            center={pixelPoint(hex)}
            size={HEX_SIZE}
          />
        );
      })}

      {/* Iron deposits — unowned ink annotations under the tokens. */}
      {state.board.iron.map((hex) => {
        const key = hexKey(hex);
        return <IronGlyph key={key} hexKey={key} center={pixelPoint(hex)} size={HEX_SIZE} />;
      })}

      {/* Factories — unowned ink glyphs. */}
      {state.factories.map((factory) => {
        const key = hexKey(factory.hex);
        return <Factory key={key} hexKey={key} center={pixelPoint(factory.hex)} size={HEX_SIZE} />;
      })}

      {/* Player base tokens on top of the map. */}
      {state.bases.map((base) => {
        const key = hexKey(base.hex);
        return (
          <Base
            key={key}
            base={base}
            center={pixelPoint(base.hex)}
            size={HEX_SIZE}
            stranded={strandedHexes?.has(key) ?? false}
          />
        );
      })}
    </svg>
  );
}

function pixelPoint(hex: HexModel): { x: number; y: number } {
  const { px, py } = hexToPixel(hex, HEX_SIZE);
  return { x: px, y: py };
}

// The build/attack/placement sets are mutually exclusive per cell by construction (a hex is a
// build target OR an attack target OR a placement slot, never two at once); build wins if they
// ever overlap, which is a harmless deterministic tie-break.
function highlightFor(key: string, highlights: HighlightSets | undefined): HexHighlight {
  if (highlights === undefined) return null;
  if (highlights.buildHexes.has(key)) return "build";
  if (highlights.attackTargets.has(key)) return "attack";
  if (highlights.placementHexes.has(key)) return "placement";
  return null;
}

// Every hex touched by the in-progress selection (attackers, target, staged pieces) reads as
// selected — the brass treatment. Brass is the scarce accent (the Brass Budget Rule), so only
// the live composer's own cells ever take it.
function selectionKeys(selection: BoardProps["selection"]): Set<string> {
  const keys = new Set<string>();
  if (selection === undefined) return keys;
  for (const hex of selection.attackers ?? []) keys.add(hexKey(hex));
  for (const hex of selection.pieces ?? []) keys.add(hexKey(hex));
  if (selection.target !== undefined) keys.add(hexKey(selection.target));
  return keys;
}
