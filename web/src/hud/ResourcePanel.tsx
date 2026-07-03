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
 * game. Iron and factory counts come straight from `controlOf(state, player)` (GEO-8: `control()`
 * already excludes non-ally perimeter interior for radiating players, so this panel consumes its
 * `iron`/`factories` arrays as-is and never re-sums board iron/factories itself, which would
 * double-count or assume pre-GEO-8 semantics). Bases are counted directly from `state.bases`,
 * which `control()` does not report a count for.
 */
export function ResourcePanel({ state }: ResourcePanelProps) {
  const activePlayers = state.players.filter((p) => !p.eliminated);

  return (
    <section className="table-panel" aria-label="Player resources" style={PANEL_STYLE}>
      <ul role="list" style={LIST_STYLE}>
        {activePlayers.map((player) => {
          const control = controlOf(state, player.id);
          const baseCount = state.bases.filter((b) => b.owner === player.id).length;
          return (
            <li
              key={player.id}
              data-testid={`resource-row-${player.id}`}
              style={ROW_STYLE}
            >
              <PlayerShapeIcon identity={playerIdentity(player.id)} size={10} />
              <span className="mono" data-testid="resource-iron" style={FIGURE_STYLE}>
                {control.iron.length}
              </span>
              <span className="mono" data-testid="resource-factories" style={FIGURE_STYLE}>
                {control.factories.length}
              </span>
              <span className="mono" data-testid="resource-bases" style={FIGURE_STYLE}>
                {baseCount}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const PANEL_STYLE: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
};
const LIST_STYLE: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
};
const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  borderBottom: "1px solid var(--hairline)",
  paddingBottom: "0.35rem",
};
const FIGURE_STYLE: React.CSSProperties = {
  fontSize: "0.85rem",
  color: color("parchment100"),
};
