// ABOUTME: Deterministic PCG32 (PCG-XSH-RR) PRNG with explicit, immutable state.
// ABOUTME: Pure functions only — every draw returns the advanced state; no Math.random, no module state.

const MASK64 = (1n << 64n) - 1n;
const MULT = 6364136223846793005n;
const TWO_POW_32 = 0x1_0000_0000; // 2**32

/** Immutable PCG32 state. Thread the returned state forward; never reuse a pre-draw state (GEO-3). */
export interface RngState {
  readonly state: bigint;
  readonly inc: bigint;
}

/** Advance the LCG state one step (masked to 64 bits to keep bigint bounded). */
function step(state: bigint, inc: bigint): bigint {
  return (state * MULT + inc) & MASK64;
}

/**
 * Standard PCG seeding: state starts at 0, inc derived from the stream selector,
 * advance once, add the seed, advance once.
 */
export function seed(initState: bigint, initSeq = 54n): RngState {
  const inc = ((initSeq << 1n) | 1n) & MASK64;
  let state = step(0n, inc);
  state = (state + (initState & MASK64)) & MASK64;
  state = step(state, inc);
  return { state, inc };
}

/** Draw a 32-bit unsigned integer; output transform is computed from the CURRENT state, then state advances. */
export function nextUint32(s: RngState): { value: number; state: RngState } {
  const oldstate = s.state;
  const xorshifted = Number((((oldstate >> 18n) ^ oldstate) >> 27n) & 0xffffffffn);
  const rot = Number(oldstate >> 59n);
  const value = ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  return { value, state: { state: step(oldstate, s.inc), inc: s.inc } };
}

/** Uniform float in [0, 1), threading state. */
export function nextFloat(s: RngState): { value: number; state: RngState } {
  const r = nextUint32(s);
  return { value: r.value / TWO_POW_32, state: r.state };
}

/**
 * Uniform integer in [0, n) via rejection sampling to avoid modulo bias.
 * Threads state through every draw, including rejected ones. Requires n >= 1.
 */
export function nextInt(s: RngState, n: number): { value: number; state: RngState } {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`nextInt: n must be an integer >= 1, got ${n}`);
  }
  const limit = Math.floor(TWO_POW_32 / n) * n;
  let state = s;
  for (;;) {
    const r = nextUint32(state);
    state = r.state;
    if (r.value < limit) {
      return { value: r.value % n, state };
    }
  }
}
