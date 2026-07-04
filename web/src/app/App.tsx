// ABOUTME: Root application component — the app shell (top bar + board-hero main + right
// ABOUTME: rail) around the routed screen; the Table Rule governs the chrome.
import { RightRail } from "./shell/RightRail";
import { RailContentOutlet, RailContentProvider } from "./shell/rail-content";
import { TopBar } from "./shell/TopBar";
import { useBreakpoint } from "./shell/useBreakpoint";
import { Router } from "./routes";

/** The rail's resting content when no screen has published its own instruments. */
const RAIL_PLACEHOLDER = <p>Per-player resources, the factory-supply gauge, and the event log land here.</p>;

export function App() {
  const breakpoint = useBreakpoint();

  // Rail-content state lives inside the provider, so a publish re-renders only the rail outlet —
  // App must not hold or subscribe to rail content, or the routed screen re-renders on every publish.
  return (
    <RailContentProvider>
      <div className="table-surface" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <TopBar />
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <main style={{ flex: 1, minWidth: 0 }}>
            <Router />
          </main>
          <RightRail breakpoint={breakpoint}>
            <RailContentOutlet placeholder={RAIL_PLACEHOLDER} />
          </RightRail>
        </div>
      </div>
    </RailContentProvider>
  );
}
