// ABOUTME: Parity oracle for control() — asserts current control() output hashes bit-identical to the golden snapshot.
// ABOUTME: Golden captured on the UNMODIFIED control() via scripts/control-parity-capture.ts; guards the perf rewrite against ANY behavior drift.

import { describe, expect, it } from "vitest";
import golden from "./fixtures/control-parity.golden.json";
import { buildBattery, canonicalControl, controlHash, type GoldenCase } from "./control-parity-battery";

const GOLDEN = golden as GoldenCase[];

describe("control() parity battery — golden snapshot is bit-identical", () => {
  const battery = buildBattery();

  // Live canonical control() output per battery case, keyed by case name. The
  // "oracle is not vacuous" check reads the FULL lists from here (the golden now
  // stores only a hash), while the per-case parity check below compares the live
  // hash against the golden hash.
  const liveByName = new Map(battery.map((c) => [c.name, canonicalControl(c.state, c.player)]));

  it("battery and golden snapshot are aligned (no drift in case construction)", () => {
    // The golden was captured over THIS battery; a length/name mismatch means the
    // state-construction code changed and the golden must be re-captured.
    expect(battery.map((c) => c.name)).toEqual(GOLDEN.map((g) => g.name));
  });

  it("battery is large (pins many states across regimes)", () => {
    // Sanity floor so a future refactor can't silently shrink the oracle.
    expect(battery.length).toBeGreaterThan(400);
  });

  it("battery exercises BOTH regimes and the DER #17 exclusion (oracle is not vacuous)", () => {
    // At least one case must have non-empty controlled hexes (radiating reach),
    // at least one must control iron, and the crafted DER #17 case must exclude.
    expect(liveByName.get("crafted/perimeter-square")!.hexes.length).toBeGreaterThan(0);
    expect(liveByName.get("crafted/single-base-radius-edge")!.iron.length).toBeGreaterThan(0);

    // DER #17: p0 radiating disk reaches the interior iron (reach unchanged) but
    // does NOT control it; the perimetered p1 does. The factory likewise.
    const p0 = liveByName.get("crafted/der17-radiating-excludes/p0")!;
    const p1 = liveByName.get("crafted/der17-radiating-excludes/p1")!;
    expect(p0.hexes).toContain("0,0,0"); // reach still covers the iron hex
    expect(p0.iron).not.toContain("0,0,0"); // but it is excluded from ownership
    expect(p1.iron).toContain("0,0,0"); // the perimeter owner keeps it
    expect(p0.factories).not.toContain("1,-1,0");
    expect(p1.factories).toContain("1,-1,0");

    // Ally case: same geometry, allied — p0 KEEPS the interior iron.
    const ally = liveByName.get("crafted/der17-ally-keeps/p0")!;
    expect(ally.iron).toContain("0,0,0");
  });

  // The golden stores one SHA-256 hash per state (not the full lists) — a hash
  // mismatch still fails on ANY output change (a hex in/out, an iron/factory
  // shift, a DER #17 case moving), keeping full 1269-state coverage. On failure
  // the message names the diverging STATE; to see WHICH hex moved, re-run
  // `bunx tsx scripts/control-parity-capture.ts` after temporarily having the
  // capture emit canonicalControl(), or diff canonicalControl() for that one
  // case against expectations. The hash localizes to a state, not a hex — the
  // accepted tradeoff for an ~80x smaller golden.
  it.each(GOLDEN.map((g, i) => [i, g.name] as const))(
    "case #%i %s → control() hash matches golden",
    (i, name) => {
      const c = battery[i]!;
      expect(c.name).toBe(name); // index alignment guard
      expect(controlHash(canonicalControl(c.state, c.player))).toBe(GOLDEN[i]!.hash);
    },
  );
});
