// ABOUTME: FactoryGauge — the shared "X / Y" factory-supply readout (UI brief §8), reading the
// ABOUTME: total from config.factorySupply rather than a hardcoded 36.
import { factoriesPlaced } from "../engine-client/selectors";
import { color } from "../design/tokens";
import type { GameState } from "../engine-client/barrel";

export interface FactoryGaugeProps {
  readonly state: GameState;
}

/**
 * The prominent shared factory-supply gauge (UI brief §5). `factoriesPlaced(state)` is
 * `config.factorySupply - state.factorySupply` (the selectors module already derives this
 * rule-agnostically); the total shown is `state.config.factorySupply` itself, never a literal
 * 36 — the default happens to be 36 but `RuleConfig.factorySupply` is a tunable knob.
 */
export function FactoryGauge({ state }: FactoryGaugeProps) {
  const placed = factoriesPlaced(state);
  const total = state.config.factorySupply;

  return (
    <section className="table-panel" aria-label="Factory supply" style={PANEL_STYLE}>
      <span className="mono" data-testid="factory-gauge" style={FIGURE_STYLE}>
        {placed} / {total}
      </span>
    </section>
  );
}

const PANEL_STYLE: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
};
const FIGURE_STYLE: React.CSSProperties = {
  fontSize: "1.1rem",
  color: color("parchment100"),
};
