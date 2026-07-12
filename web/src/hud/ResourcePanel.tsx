// ABOUTME: ResourcePanel — one shape-tagged mono row per non-eliminated player showing iron,
// ABOUTME: factories, and bases counts, sourced from controlOf (the memoized control() selector).
import { PlayerShapeIcon } from "../identity/shapes";
import { playerIdentity } from "../identity/player-identity";
import { controlOf } from "../engine-client/selectors";
import { color } from "../design/tokens";
import type { GameState } from "../engine-client/barrel";

export interface ResourcePanelProps {
  readonly state: GameState;
}

/**
 * Per-player resource readout — the right rail's instrument row for each seat still in the
 * game, as a real table so the three count columns carry visible, screen-reader-real headers.
 * Iron and factory counts come straight from `controlOf(state, player)` (GEO-8: `control()`
 * already excludes non-ally perimeter interior for radiating players, so this panel consumes its
 * `iron`/`factories` arrays as-is and never re-sums board iron/factories itself, which would
 * double-count or assume pre-GEO-8 semantics). Bases are counted directly from `state.bases`,
 * which `control()` does not report a count for.
 */
export function ResourcePanel({ state }: ResourcePanelProps) {
  const activePlayers = state.players.filter((p) => !p.eliminated);

  return (
    <section className="table-panel" aria-label="Player resources" style={PANEL_STYLE}>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <th scope="col" aria-label="player" style={HEADER_STYLE} />
            <th scope="col" className="mono" style={HEADER_STYLE}>
              iron
            </th>
            <th scope="col" className="mono" style={HEADER_STYLE}>
              factories
            </th>
            <th scope="col" className="mono" style={HEADER_STYLE}>
              bases
            </th>
          </tr>
        </thead>
        <tbody>
          {activePlayers.map((player) => {
            const control = controlOf(state, player.id);
            const baseCount = state.bases.filter((b) => b.owner === player.id).length;
            return (
              <tr key={player.id} data-testid={`resource-row-${player.id}`}>
                <th scope="row" aria-label={`Player ${player.id + 1}`} style={ROW_HEAD_STYLE}>
                  <PlayerShapeIcon identity={playerIdentity(player.id)} size={10} />
                </th>
                <td className="mono" data-testid="resource-iron" style={FIGURE_STYLE}>
                  {control.iron.length}
                </td>
                <td className="mono" data-testid="resource-factories" style={FIGURE_STYLE}>
                  {control.factories.length}
                </td>
                <td className="mono" data-testid="resource-bases" style={FIGURE_STYLE}>
                  {baseCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const PANEL_STYLE: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
};
const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};
const HEADER_STYLE: React.CSSProperties = {
  fontSize: "0.65rem",
  fontWeight: 400,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textAlign: "right",
  color: color("parchment300"),
  padding: "0 0 0.3rem",
};
const ROW_HEAD_STYLE: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid var(--hairline)",
  padding: "0.2rem 0",
};
const FIGURE_STYLE: React.CSSProperties = {
  fontSize: "0.85rem",
  textAlign: "right",
  color: color("parchment100"),
  borderBottom: "1px solid var(--hairline)",
  padding: "0.2rem 0 0.2rem 0.6rem",
};
