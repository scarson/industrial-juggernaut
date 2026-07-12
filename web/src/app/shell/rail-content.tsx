// ABOUTME: The rail-content seam — a screen publishes a ReactNode for the shell's right rail, and a
// ABOUTME: rail-side consumer reads it, without the publish re-rendering the passed-through children.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { RightRail } from "./RightRail";
import type { Breakpoint } from "./useBreakpoint";

/** The content a screen has published for the shell rail, or `null` when no rail should exist. */
const RailContentContext = createContext<ReactNode>(null);

/** Sets the rail's content. Split into its own context so its identity stays stable across content
 *  changes — a publisher can list it as an effect dependency without re-running on every change. */
type SetRailContent = (content: ReactNode) => void;

const noop: SetRailContent = () => {};

/** Defaults to a no-op so a screen that publishes rail content still works when mounted (e.g. in a
 *  test) without a provider — the publish simply goes nowhere. */
const SetRailContentContext = createContext<SetRailContent>(noop);

export interface RailContentProviderProps {
  readonly children: ReactNode;
}

/**
 * Holds the published rail content in its own state and exposes it through two contexts — the content
 * and its setter. `children` is passed straight through: because its element identity is stable across
 * this provider's re-renders, React bails out of the children subtree on a content change, re-rendering
 * only the components that consume one of these contexts. That is what keeps a publish from re-rendering
 * the routed screen while still delivering the content to the rail-side consumer.
 */
export function RailContentProvider({ children }: RailContentProviderProps) {
  const [content, setContent] = useState<ReactNode>(null);
  // A stable setter identity: `useState`'s setter is already stable, so this memo never recomputes.
  const set = useMemo<SetRailContent>(() => (next) => setContent(next), []);

  return (
    <SetRailContentContext.Provider value={set}>
      <RailContentContext.Provider value={content}>{children}</RailContentContext.Provider>
    </SetRailContentContext.Provider>
  );
}

/** The content currently published for the rail, or `null`. Rail-side consumers read this. */
export function useRailContent(): ReactNode {
  return useContext(RailContentContext);
}

/** The stable setter a screen calls to publish (or clear, with `null`) its rail content. */
export function useSetRailContent(): SetRailContent {
  return useContext(SetRailContentContext);
}

export interface RailHostProps {
  readonly breakpoint: Breakpoint;
}

/**
 * Mounts the shell rail ONLY while a screen has published instruments into it — a rail with
 * nothing to hold earns no pixels (DESIGN.md: panels earn their pixels), so the landing, the
 * viewer, and the rules reference get the full table width. As the content-context consumer
 * it re-renders on a publish; hosting the subscription here (not in the shell's render body)
 * keeps a content change from re-rendering the routed screen alongside it.
 */
export function RailHost({ breakpoint }: RailHostProps) {
  const content = useRailContent();
  if (content === null) return null;
  return <RightRail breakpoint={breakpoint}>{content}</RightRail>;
}
