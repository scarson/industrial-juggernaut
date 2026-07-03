// ABOUTME: TurnOrderTokens — state.phase.order rendered as shape-tagged identity tokens, with
// ABOUTME: the current seat (currentSeat/phase.indexInOrder) visually emphasized.
import { PlayerShapeIcon } from "../identity/shapes";
import { playerIdentity } from "../identity/player-identity";
import { currentSeat } from "../engine-client/selectors";
import { color } from "../design/tokens";
import type { GameState } from "../engine-client/barrel";

export interface TurnOrderTokensProps {
  readonly state: GameState;
}

/**
 * The round's turn order (`state.phase.order`) as a row of shape-tagged tokens, in order. The
 * current seat — `currentSeat(state)`, i.e. `phase.order[phase.indexInOrder]` — is emphasized
 * with the brass accent (the current-player emphasis is the one place this instrument spends
 * its brass budget; see DESIGN.md's Brass Budget Rule).
 */
export function TurnOrderTokens({ state }: TurnOrderTokensProps) {
  const current = currentSeat(state);

  return (
    <section className="table-panel" aria-label="Turn order" style={PANEL_STYLE}>
      <ol role="list" className="mono" style={LIST_STYLE}>
        {state.phase.order.map((seat) => {
          const isCurrent = seat === current;
          return (
            <li
              key={seat}
              data-testid={`turn-order-token-${seat}`}
              data-seat={seat}
              data-current={isCurrent}
              style={isCurrent ? { ...TOKEN_STYLE, ...CURRENT_TOKEN_STYLE } : TOKEN_STYLE}
            >
              <PlayerShapeIcon identity={playerIdentity(seat)} size={10} />
              <span style={SEAT_LABEL_STYLE}>{seat}</span>
            </li>
          );
        })}
      </ol>
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
  flexDirection: "row",
  gap: "0.5rem",
};
const TOKEN_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.15rem 0.35rem",
  // Longhand (not the `border` shorthand) so the current-seat override can replace only
  // `borderColor` without a shorthand/longhand reconciliation conflict on a turn advance.
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--hairline)",
};
const CURRENT_TOKEN_STYLE: React.CSSProperties = {
  borderColor: color("brass500"),
};
const SEAT_LABEL_STYLE: React.CSSProperties = {
  fontSize: "0.8rem",
  color: color("parchment100"),
};
