// ABOUTME: Pins the version-mismatch reload guard — reload at most once per page load, loop-detect after.
// ABOUTME: Storage is injected (a fake Storage-shaped stub) so tests never touch real sessionStorage.
import { describe, expect, test } from "vitest";
import { clearReloadMarker, handleReload, RELOAD_MARKER_KEY } from "./reload-guard";

/** A minimal in-memory stand-in for the injected `{ getItem, setItem, removeItem }` boundary — the real
 *  seam is `window.sessionStorage`. Starts empty (a fresh page load with no prior reload) unless seeded. */
function fakeStorage(seed?: Record<string, string>): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  const backing = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => { backing.set(k, v); },
    removeItem: (k) => { backing.delete(k); },
  };
}

describe("handleReload", () => {
  test("first signal (no marker): reloads exactly once and writes the marker", () => {
    const storage = fakeStorage();
    let reloadCalls = 0;
    const outcome = handleReload({ reloadFn: () => { reloadCalls += 1; }, storage });

    expect(outcome).toBe("reloaded");
    expect(reloadCalls).toBe(1);
    expect(storage.getItem(RELOAD_MARKER_KEY)).not.toBeNull(); // marker persisted for the next load
  });

  test("second signal in the SAME load (marker now present): loop-detected, does NOT reload", () => {
    const storage = fakeStorage();
    let reloadCalls = 0;
    const reloadFn = () => { reloadCalls += 1; };

    handleReload({ reloadFn, storage });          // first: reloads, writes marker
    const second = handleReload({ reloadFn, storage }); // second: marker is present → loop

    expect(second).toBe("loop-detected");
    expect(reloadCalls).toBe(1); // reloadFn called AT MOST once across both calls in this load
  });

  test("fresh load with a pre-existing marker (post-reload page): loop-detected on the FIRST signal", () => {
    // Simulates the browser AFTER a real location.reload(): sessionStorage survived, so the marker is
    // already there. A second reload-required in this new load means the mismatch isn't cache-fixable.
    const storage = fakeStorage({ [RELOAD_MARKER_KEY]: "1" });
    let reloadCalls = 0;
    const outcome = handleReload({ reloadFn: () => { reloadCalls += 1; }, storage });

    expect(outcome).toBe("loop-detected");
    expect(reloadCalls).toBe(0); // never reloads when we already reloaded once this load-cycle
  });

  test("reloadFn is called AT MOST once across many signals in one load", () => {
    const storage = fakeStorage();
    let reloadCalls = 0;
    const reloadFn = () => { reloadCalls += 1; };

    const outcomes = [
      handleReload({ reloadFn, storage }),
      handleReload({ reloadFn, storage }),
      handleReload({ reloadFn, storage }),
      handleReload({ reloadFn, storage }),
    ];

    expect(reloadCalls).toBe(1);
    expect(outcomes).toEqual(["reloaded", "loop-detected", "loop-detected", "loop-detected"]);
  });

  test("the marker key is specific/namespaced (not a generic key that could collide)", () => {
    // A generic key like "reload" or "marker" would collide with any other feature stashing state in
    // sessionStorage under a common name. The guard's key must be app-and-purpose scoped.
    expect(RELOAD_MARKER_KEY).toMatch(/juggernaut/);
    expect(RELOAD_MARKER_KEY).toMatch(/reload/);
  });
});

describe("clearReloadMarker", () => {
  test("removes the marker, so a fresh handleReload reloads again (a later genuine mismatch is not a loop)", () => {
    const storage = fakeStorage();
    let reloadCalls = 0;
    const reloadFn = () => { reloadCalls += 1; };

    handleReload({ reloadFn, storage });                 // first mismatch: reloads, writes marker
    expect(storage.getItem(RELOAD_MARKER_KEY)).not.toBeNull();

    clearReloadMarker(storage);                           // mismatch resolved (a healthy handshake)
    expect(storage.getItem(RELOAD_MARKER_KEY)).toBeNull(); // marker gone

    // A LATER genuine version-mismatch (a future deploy) is allowed its one reload, not loop-detected.
    const outcome = handleReload({ reloadFn, storage });
    expect(outcome).toBe("reloaded");
    expect(reloadCalls).toBe(2);
  });

  test("clearing an already-clear marker is a no-op (idempotent)", () => {
    const storage = fakeStorage();
    clearReloadMarker(storage);
    expect(storage.getItem(RELOAD_MARKER_KEY)).toBeNull();
  });
});
