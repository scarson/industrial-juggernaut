// ABOUTME: Root application component — the app shell (top bar + board-hero main + right
// ABOUTME: rail) around the routed screen; the Table Rule governs the chrome.
import { RightRail } from "./shell/RightRail";
import { TopBar } from "./shell/TopBar";
import { useBreakpoint } from "./shell/useBreakpoint";
import { Router } from "./routes";

export function App() {
  const breakpoint = useBreakpoint();

  return (
    <div className="table-surface" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <main style={{ flex: 1, minWidth: 0 }}>
          <Router />
        </main>
        <RightRail breakpoint={breakpoint}>
          <p>Per-player resources, the factory-supply gauge, and the event log land here.</p>
        </RightRail>
      </div>
    </div>
  );
}
