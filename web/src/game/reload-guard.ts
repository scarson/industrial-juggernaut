// ABOUTME: Decides whether a version-mismatch reload signal should hard-reload the page or show a
// ABOUTME: manual-refresh notice — reload at most once per page load, so a deeper mismatch can't loop.
//
// WHY A LOOP GUARD. The DO host sends a `reload` message when the browser's cached SPA assets are on a
// different protocol/replay version than the redeployed DO. Workers static assets are content-hashed, so
// after ONE reload the browser fetches fresh assets that match the DO and the mismatch resolves. But if a
// SECOND signal arrives in the SAME page load (right after a reload), reloading again would loop forever —
// that deeper mismatch is not cache-fixable. So the guard reloads at most once per load; a second signal
// within the same load yields "loop-detected", the cue for P4.5 to render a friendly "please refresh".
//
// WHY sessionStorage, NOT localStorage. The marker must answer exactly one question: "did we already reload
// once in THIS load-cycle?" `sessionStorage` survives `location.reload()` (so the post-reload page load sees
// the marker and loop-detects) but is cleared when the tab/session ends (so a genuinely fresh tab starts
// clean and is allowed its one reload). `localStorage` would persist across tabs and days, wrongly
// suppressing the legitimate first reload of every later visit.

/** The sessionStorage key holding the "already reloaded once this load-cycle" marker. App-and-purpose
 *  scoped so it can never collide with another feature stashing state in sessionStorage. */
export const RELOAD_MARKER_KEY = "industrial-juggernaut:reload-guard:reloaded";

/** The value written under `RELOAD_MARKER_KEY` — only its presence matters, never its contents. */
const RELOAD_MARKER_VALUE = "1";

/** What the guard decided for one reload signal: it triggered the single allowed reload, or it detected a
 *  loop (we already reloaded once this load) and the caller should show a manual-refresh notice instead. */
export type ReloadOutcome = "reloaded" | "loop-detected";

/** The `window.sessionStorage`-shaped slice the guard reads/writes — narrowed to the two methods it uses so
 *  tests inject a deterministic in-memory stub instead of touching real sessionStorage. */
type MarkerStorage = Pick<Storage, "getItem" | "setItem">;

export type HandleReloadArgs = {
  /** Performs the hard reload (production wires `() => window.location.reload()`, P4.5). Called at most
   *  once per page load — never on a signal that arrives after the marker is already set. */
  reloadFn: () => void;
  /** The load-scoped marker store. Defaults to `window.sessionStorage`; tests inject a stub. */
  storage?: MarkerStorage;
};

/**
 * Handle one version-mismatch reload signal. On the FIRST signal of a page load (no marker present) it
 * writes the marker and invokes `reloadFn` once, returning `"reloaded"`. On any SUBSEQUENT signal in the
 * same load — or the first signal of a page load that already carries the marker (i.e. the load produced by
 * a prior reload) — it does NOT reload and returns `"loop-detected"`, signalling that a manual-refresh
 * notice should be shown.
 */
export function handleReload({ reloadFn, storage = window.sessionStorage }: HandleReloadArgs): ReloadOutcome {
  if (storage.getItem(RELOAD_MARKER_KEY) !== null) {
    // We already reloaded once this load-cycle; a second signal means the mismatch isn't cache-fixable.
    return "loop-detected";
  }
  storage.setItem(RELOAD_MARKER_KEY, RELOAD_MARKER_VALUE);
  reloadFn();
  return "reloaded";
}
