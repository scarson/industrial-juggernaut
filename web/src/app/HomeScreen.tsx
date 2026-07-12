// ABOUTME: The landing screen — the North Star scene itself: title plate, the aged map open
// ABOUTME: on the lamplit table (real Board render, lazy chunk), and the entry instruments.
import { lazy, Suspense } from "react";
import { navigate } from "./routes";

// The map hero value-imports engine code (scene generation), so it loads from its own lazy
// chunk — the same entry-graph discipline as the drivers and the dev board page. The plate
// itself renders immediately; the map develops into it.
const TableVignette = lazy(() => import("./home/TableVignette"));

/**
 * The landing: "a dark wooden surface where a beautiful aged map lies open, instruments and
 * counters arranged around it" (DESIGN.md's North Star, rendered literally). The title plate
 * is the Cartouche Rule's sanctioned display-serif moment; the map is the hero, glowing at
 * center under lamplight; the three entry actions are instruments on the table — one brass
 * (Begin), two quiet chrome.
 */
export function HomeScreen() {
  return (
    <div className="landing">
      <h1 className="cartouche landing-title">Industrial Juggernaut</h1>
      <p className="landing-flavor">A game of industrial expansion &amp; military domination.</p>
      <p className="mono landing-facts">2–6 players · hexes, iron &amp; factories</p>
      <div className="landing-ornament" aria-hidden="true">
        <span className="landing-rule" />
        <span className="landing-fleuron">◆</span>
        <span className="landing-rule" />
      </div>

      <div className="landing-lamplight">
        <div className="landing-tilt">
          <div className="landing-plate board-surface" data-testid="landing-plate">
            <div className="landing-plate-frame">
              <Suspense fallback={<span className="mono landing-plate-note">Laying out the map…</span>}>
                <TableVignette />
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      <div className="landing-instruments">
        <button
          type="button"
          className="chrome-button brass-accent-bg landing-instrument"
          style={instrumentIndex(0)}
          onClick={() => navigate("/game")}
        >
          Begin a game
        </button>
        <button
          type="button"
          className="chrome-button landing-instrument"
          style={instrumentIndex(1)}
          onClick={() => navigate("/viewer")}
        >
          Watch the agents play
        </button>
        <button
          type="button"
          className="chrome-button landing-instrument"
          style={instrumentIndex(2)}
          onClick={() => navigate("/rules")}
        >
          Read the rules
        </button>
      </div>
    </div>
  );
}

/** The `--i` custom property drives each instrument's entrance stagger (landing.css). */
function instrumentIndex(i: number): React.CSSProperties {
  return { ["--i"]: i } as React.CSSProperties;
}
