// ABOUTME: The shell-labels seam — a screen publishes the top bar's turn/seed labels, and the
// ABOUTME: TopBarHost consumes them, without App holding or subscribing to game state.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { TopBar } from "./TopBar";

/** What a screen publishes for the top bar's instrument readouts, or `null` for none. */
export type ShellLabels = { turnLabel: string; seedLabel: string };

const ShellLabelsContext = createContext<ShellLabels | null>(null);

type SetShellLabels = (labels: ShellLabels | null) => void;

const noop: SetShellLabels = () => {};

/** Defaults to a no-op so a screen publishing labels still works without a provider (tests). */
const SetShellLabelsContext = createContext<SetShellLabels>(noop);

export interface ShellLabelsProviderProps {
  readonly children: ReactNode;
}

/**
 * Holds the published labels in its own state, split across a content context and a stable-setter
 * context — the same discipline as rail-content: `children`'s element identity is stable across a
 * publish, so React bails out of the routed screen and re-renders only the label consumer
 * (TopBarHost). App must never hold or subscribe to these labels itself.
 */
export function ShellLabelsProvider({ children }: ShellLabelsProviderProps) {
  const [labels, setLabels] = useState<ShellLabels | null>(null);
  const set = useMemo<SetShellLabels>(() => (next) => setLabels(next), []);

  return (
    <SetShellLabelsContext.Provider value={set}>
      <ShellLabelsContext.Provider value={labels}>{children}</ShellLabelsContext.Provider>
    </SetShellLabelsContext.Provider>
  );
}

/** The labels currently published for the top bar, or `null`. */
export function useShellLabels(): ShellLabels | null {
  return useContext(ShellLabelsContext);
}

/** The stable setter a screen calls to publish (or clear, with `null`) its top-bar labels. */
export function useSetShellLabels(): SetShellLabels {
  return useContext(SetShellLabelsContext);
}

export interface TopBarHostProps {
  readonly onWordmarkClick?: (() => void) | undefined;
  readonly onInstrumentsClick?: (() => void) | undefined;
}

/**
 * Renders the shell TopBar with whatever labels the current screen has published. Hosting the
 * label subscription here (not in App's render body) keeps a label publish from re-rendering the
 * routed screen — the render-scoping invariant App.test.tsx pins for the rail applies here too.
 */
export function TopBarHost({ onWordmarkClick, onInstrumentsClick }: TopBarHostProps) {
  const labels = useShellLabels();
  return (
    <TopBar
      {...(labels !== null ? { turnLabel: labels.turnLabel, seedLabel: labels.seedLabel } : {})}
      {...(onWordmarkClick !== undefined ? { onWordmarkClick } : {})}
      {...(onInstrumentsClick !== undefined ? { onInstrumentsClick } : {})}
    />
  );
}
