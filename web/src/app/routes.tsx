// ABOUTME: A minimal path-based router (history.pushState + popstate) for the 4 static P0
// ABOUTME: routes. No react-router: 4 fixed paths don't warrant the dependency (see P0.7 plan).
import { lazy, Suspense, useEffect, useState } from "react";
import { NewGame } from "../designer/NewGame";
import { AgentViewer } from "../viewer/AgentViewer";

const ROUTES = ["/", "/game", "/viewer", "/rules"] as const;
type RoutePath = (typeof ROUTES)[number];

// DEV-ONLY scratch route for eyeballing the board renderer (P1.3). No product route links here;
// it is replaced by P2's real viewer. Kept out of the typed ROUTES tuple so the 4 product routes
// stay the authoritative set. Lazily imported so the dev page (and its board/engine imports)
// stays out of the eager product chunk.
const DEV_BOARD_PATH = "/dev/board";
const DevBoardPage = lazy(() =>
  import("../board/dev/DevBoardPage").then((m) => ({ default: m.DevBoardPage })),
);

/**
 * Navigates to `path` via `history.pushState` (no full page load — the Worker's SPA fallback
 * means a hard navigation would also work, but this keeps in-app transitions instant) and
 * notifies every mounted `Router` by dispatching a synthetic `popstate`, since `pushState`
 * itself does not fire one.
 */
export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isRoutePath(path: string): path is RoutePath {
  return (ROUTES as readonly string[]).includes(path);
}

/** Renders the screen matching the current URL path, live-updating on navigate()/back/forward. */
export function Router() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (path === DEV_BOARD_PATH) {
    return (
      <Suspense fallback={null}>
        <DevBoardPage />
      </Suspense>
    );
  }

  if (!isRoutePath(path)) {
    return <NotFoundScreen />;
  }

  switch (path) {
    case "/":
      return <HomeScreen />;
    case "/game":
      return <GameScreen />;
    case "/viewer":
      return <ViewerScreen />;
    case "/rules":
      return <RulesScreen />;
  }
}

function HomeScreen() {
  return (
    <section className="table-panel">
      <h1>Home</h1>
      <p>Start or resume a game of Industrial Juggernaut.</p>
    </section>
  );
}

function GameScreen() {
  // P2.4 smoke mount: the game board + action composers land in P3; until then the /game route
  // hosts the new-game designer instrument so it can be exercised in-app. onStart logs the
  // assembled header (P2.7's viewer / P3's game screen are the real consumers).
  return (
    <NewGame
      onStart={(header) => {
        // eslint-disable-next-line no-console
        console.log("[NewGame] onStart", { ...header, seed: header.seed.toString() });
      }}
    />
  );
}

function ViewerScreen() {
  // The product route (not a dev stub): the all-agent viewer where designers watch a game play
  // itself. AgentViewer defaults its `generateGame` to the real off-main-thread worker.
  return <AgentViewer />;
}

function RulesScreen() {
  return (
    <section className="table-panel">
      <h1>Rules</h1>
      <p>The rules reference, with Digital Edition Ruling callouts merged inline.</p>
    </section>
  );
}

function NotFoundScreen() {
  return (
    <section className="table-panel">
      <h1>Not found</h1>
      <p>There's no screen at this address.</p>
    </section>
  );
}
