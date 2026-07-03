// ABOUTME: Tests assertNoAgentsInEager against in-memory module-map fixtures shaped like the
// ABOUTME: bundle-guard plugin's emitted output — proves both the failure path and the allow path.
import { describe, expect, test } from "vitest";
import { assertNoAgentsInEager } from "./check-bundle";

describe("assertNoAgentsInEager", () => {
  test("returns ok for an eager entry chunk with no agent modules", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/engine/rules.ts", "/repo/src/board/hex.ts"],
      },
    };

    expect(() => assertNoAgentsInEager(moduleMap)).not.toThrow();
  });

  test("throws naming the offending module and chunk when an eager chunk contains an agent module", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/agent/greedy.ts"],
      },
    };

    expect(() => assertNoAgentsInEager(moduleMap)).toThrow(/src\/agent\/greedy\.ts/);
    expect(() => assertNoAgentsInEager(moduleMap)).toThrow(/index\.js/);
  });

  test("allows an agent module inside a dynamically-imported chunk", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        moduleIds: ["/repo/web/src/main.tsx"],
      },
      "agent-worker.js": {
        isEntry: false,
        dynamicallyImported: true,
        moduleIds: ["/repo/src/agent/greedy.ts", "/repo/src/agent/heuristic.ts"],
      },
    };

    expect(() => assertNoAgentsInEager(moduleMap)).not.toThrow();
  });

  test("treats a non-entry, non-dynamic chunk (e.g. a shared eager sub-chunk) as eager", () => {
    // isEntry: false but dynamicallyImported: false — reached only via static imports from the
    // entry, so it ships in the initial payload just like the entry chunk itself (v1 treatment).
    const moduleMap = {
      "shared-vendor.js": {
        isEntry: false,
        dynamicallyImported: false,
        moduleIds: ["/repo/src/agent/mcts.ts"],
      },
    };

    expect(() => assertNoAgentsInEager(moduleMap)).toThrow(/src\/agent\/mcts\.ts/);
    expect(() => assertNoAgentsInEager(moduleMap)).toThrow(/shared-vendor\.js/);
  });
});
