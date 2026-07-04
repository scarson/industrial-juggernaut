// ABOUTME: Tests assertNoLazyOnlyModulesInEager against in-memory module-map fixtures shaped like the
// ABOUTME: bundle-guard plugin's emitted output — proves both the failure path and the allow path.
import { describe, expect, test } from "vitest";
import { assertNoLazyOnlyModulesInEager } from "./check-bundle";

describe("assertNoLazyOnlyModulesInEager", () => {
  test("returns ok for an eager entry chunk with no agent or wire modules", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/engine/rules.ts", "/repo/src/board/hex.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).not.toThrow();
  });

  test("throws naming the offending module and chunk when an eager chunk contains an agent module", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/agent/greedy.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/src\/agent\/greedy\.ts/);
    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/index\.js/);
  });

  test("throws naming the offending module and chunk when an eager chunk contains a wire module", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        moduleIds: ["/repo/web/src/main.tsx", "/repo/src/wire/codec.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/src\/wire\/codec\.ts/);
    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/index\.js/);
  });

  test("allows agent and wire modules inside a dynamically-imported chunk", () => {
    const moduleMap = {
      "index.js": {
        isEntry: true,
        dynamicallyImported: false,
        moduleIds: ["/repo/web/src/main.tsx"],
      },
      "driver-chunk.js": {
        isEntry: false,
        dynamicallyImported: true,
        moduleIds: ["/repo/src/agent/greedy.ts", "/repo/src/agent/heuristic.ts", "/repo/src/wire/codec.ts"],
      },
    };

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).not.toThrow();
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

    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/src\/agent\/mcts\.ts/);
    expect(() => assertNoLazyOnlyModulesInEager(moduleMap)).toThrow(/shared-vendor\.js/);
  });
});
