// ABOUTME: Pins that BoardSource lives in engine/types and is re-exported from driver/record.
// ABOUTME: A type-presence smoke — fails typecheck if the move or re-export regresses.
import { test, expect } from "vitest";
import type { BoardSource as FromEngine } from "../../src/engine/types";
import type { BoardSource as FromDriver } from "../../src/driver/record";

test("BoardSource is exported from engine/types and re-exported from driver/record", () => {
  const a: FromEngine = { kind: "generate", size: 96, ironCount: 14 };
  const b: FromDriver = { kind: "fixed", def: { hexes: [], iron: [] } };
  expect(a.kind).toBe("generate");
  expect(b.kind).toBe("fixed");
});
