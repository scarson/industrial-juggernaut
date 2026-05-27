import { describe, it, expect } from "vitest";
import { seed, nextUint32, nextFloat, nextInt, type RngState } from "../../src/rng/pcg";

describe("pcg", () => {
  it("is deterministic for a seed", () => {
    const a = seq(seed(42n), 5);
    const b = seq(seed(42n), 5);
    expect(a).toEqual(b);
  });
  it("differs across seeds", () => {
    expect(seq(seed(1n), 5)).not.toEqual(seq(seed(2n), 5));
  });
  it("nextFloat is in [0,1)", () => {
    let s = seed(7n);
    for (let i = 0; i < 1000; i++) { const r = nextFloat(s); expect(r.value).toBeGreaterThanOrEqual(0); expect(r.value).toBeLessThan(1); s = r.state; }
  });
  it("nextInt(s,n) is in [0,n) and roughly uniform over many draws", () => {
    let s = seed(9n); const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) { const r = nextInt(s, 6); counts[r.value]++; s = r.state; }
    for (const c of counts) expect(c).toBeGreaterThan(8000); // each ~10000
  });
});
function seq(s0: RngState, n: number): number[] {
  let s = s0; const out: number[] = [];
  for (let i = 0; i < n; i++) { const r = nextUint32(s); out.push(r.value); s = r.state; }
  return out;
}
