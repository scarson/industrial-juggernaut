// ABOUTME: Root application component — the app shell (top bar + board-hero main + right
// ABOUTME: rail) around the routed screen; the Table Rule governs the chrome.
import { RightRail } from "./shell/RightRail";
import { TopBar } from "./shell/TopBar";
import { useBreakpoint } from "./shell/useBreakpoint";
import { Router, useCurrentPath } from "./routes";

// Routes whose screen owns its full layout (board + composers + its own HUD rail), so the shell's
// placeholder rail is suppressed to avoid a double rail. The game screen is self-contained because
// its rail needs the live store/driver; hosting the HUD in the shell rail is a later architecture
// task (see the P3 close-out follow-up).
const SELF_CONTAINED_ROUTES: ReadonlySet<string> = new Set(["/game"]);

export function App() {
  const breakpoint = useBreakpoint();
  const path = useCurrentPath();
  const showShellRail = !SELF_CONTAINED_ROUTES.has(path);

  return (
    <div className="table-surface" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <main style={{ flex: 1, minWidth: 0 }}>
          <Router />
        </main>
        {showShellRail && (
          <RightRail breakpoint={breakpoint}>
            <p>Per-player resources, the factory-supply gauge, and the event log land here.</p>
          </RightRail>
        )}
      </div>
    </div>
  );
}
