// ABOUTME: Root application component — the app shell (top bar + board-hero main + right
// ABOUTME: rail) around the routed screen; the Table Rule governs the chrome.
import { RailContentProvider, RailHost } from "./shell/rail-content";
import { TopBar } from "./shell/TopBar";
import { useBreakpoint } from "./shell/useBreakpoint";
import { navigate, Router } from "./routes";

export function App() {
  const breakpoint = useBreakpoint();

  // Rail-content state lives inside the provider, so a publish re-renders only the rail host —
  // App must not hold or subscribe to rail content, or the routed screen re-renders on every publish.
  return (
    <RailContentProvider>
      <div className="table-surface" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <TopBar onWordmarkClick={() => navigate("/")} />
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <main style={{ flex: 1, minWidth: 0 }}>
            <Router />
          </main>
          <RailHost breakpoint={breakpoint} />
        </div>
      </div>
    </RailContentProvider>
  );
}
