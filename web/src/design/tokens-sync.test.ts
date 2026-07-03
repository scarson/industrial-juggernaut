// ABOUTME: Proves tokens.css mirrors tokens.ts — every --color-* custom property equals the
// ABOUTME: matching palette entry's oklch, the key sets agree both ways, and playerColors order holds.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { color, palette, players, playerColors, type TokenName } from "./tokens";

const tokensCss = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");

/**
 * The `--color-<kebab>: <value>;` declarations from tokens.css, keyed by the CSS
 * custom-property name (e.g. `color-walnut-900`). Only the raw --color-* swatches
 * are mirrored from tokens.ts; the semantic aliases (--surface-*, --accent, …) are
 * intentionally CSS-only (see tokens.css) and are not --color-* prefixed, so this
 * regex never picks them up.
 */
function parseColorVars(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /--(color-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** The CSS custom-property name a token maps to, e.g. `walnut900` → `color-walnut-900`. */
function cssVarName(name: TokenName): string {
  // color(name) returns "var(--color-walnut-900)"; strip the wrapper to the bare name.
  return color(name).replace(/^var\(--/, "").replace(/\)$/, "");
}

const cssVars = parseColorVars(tokensCss);

describe("tokens.css mirrors tokens.ts", () => {
  test("parsed at least the full palette's worth of --color-* declarations", () => {
    // Guards against a regex that silently matches nothing (which would make the
    // per-token checks below vacuously pass).
    expect(cssVars.size).toBe(Object.keys(palette).length);
  });

  test("every palette token's oklch equals its --color-* declaration in tokens.css", () => {
    for (const name of Object.keys(palette) as TokenName[]) {
      const varName = cssVarName(name);
      expect(cssVars.get(varName)).toBe(palette[name].oklch);
    }
  });

  test("the key sets match both ways (a token in one file but not the other fails)", () => {
    const fromTs = new Set((Object.keys(palette) as TokenName[]).map(cssVarName));
    const fromCss = new Set(cssVars.keys());
    // ts → css: no typed token is missing its CSS mirror.
    for (const v of fromTs) expect(fromCss.has(v)).toBe(true);
    // css → ts: no CSS --color-* swatch lacks a typed token.
    for (const v of fromCss) expect(fromTs.has(v)).toBe(true);
  });
});

describe("cascade guards", () => {
  // jsdom cannot compute the real CSS cascade, so this pins the one known cascade
  // hazard structurally: .chrome-button's `color: inherit` reset and .brass-accent
  // have equal single-class specificity, and .chrome-button is declared later — so
  // without a compound override, a `chrome-button brass-accent` element (the
  // Instruments button) loses its brass by source order. The compound selector
  // must exist and must set the accent color.
  test("the .chrome-button.brass-accent compound override restores the brass", () => {
    const rule = tokensCss.match(/\.chrome-button\.brass-accent\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/color:\s*var\(--accent\)/);
  });

  test("the brass hover glint uses brass-400", () => {
    const hover = tokensCss.match(/\.chrome-button\.brass-accent:hover\s*\{([^}]*)\}/);
    expect(hover).not.toBeNull();
    expect(hover![1]).toMatch(/color:\s*var\(--color-brass-400\)/);
  });
});

describe("playerColors positional stability", () => {
  // P0.5's playerIdentity(id) contract pins "id 0 = oxide-red"; this order is a
  // published contract, not an implementation detail — assert it explicitly.
  test("the six player colors keep their committed-then-extension order", () => {
    expect(playerColors).toEqual([
      players.oxide,
      players.cobalt,
      players.violet,
      players.gold,
      players.steel,
      players.forest,
    ]);
  });
});

describe("hex↔oklch consistency", () => {
  // tokens.ts pairs `hex` and `oklch` by hand (see its top-of-file comment) — nothing
  // upstream of this test proves the two encode the same color. tokens-sync above only
  // proves tokens.ts and tokens.css *agree with each other*; a single-field edit to
  // either the hex or the oklch half of a PaletteColor would pass every other test in
  // this file while silently certifying a phantom color through the CVD/AA gate (which
  // reads only `.hex`) while the browser renders the drifted `.oklch`.
  //
  // Direction: hex -> OKLCH (not OKLCH -> sRGB). cvd-check.ts already exports the sRGB
  // linearization this needs (hexToSrgb-equivalent parsing + the sRGB EOTF), and hex ->
  // linear sRGB -> OKLab -> OKLCH is the direct Björn Ottosson formulation (no XYZ
  // detour required). The reverse direction would additionally need the sRGB OETF
  // (gamma re-encode), which nothing in this codebase has yet — this path is strictly
  // less new math.
  //
  // Tolerance: every one of the 15 current palette entries round-trips to within
  // dL < 6e-5 (L as a 0..1 fraction), dC < 5e-5, dH < 5e-3 degrees of its recorded
  // oklch string — that residual is exactly the rounding of the hand-recorded oklch
  // strings to their printed precision (L%/H to 2 decimals, C to 4), not real drift.
  // A realistic single-field slip (e.g. an L% typo off by whole percentage points)
  // produces dL on the order of 1e-2 to 1e-1 — three to four orders of magnitude
  // above that noise floor. The tolerances below (L fraction ±0.001, C ±0.001, H
  // ±0.05°) sit comfortably above the rounding noise and comfortably below any
  // plausible typo, so the gate has real teeth without being flaky.

  /** Parse `#rrggbb` into sRGB channels in [0, 1]. Mirrors cvd-check.ts's hexToSrgb. */
  function hexToSrgb(hex: string): readonly [number, number, number] {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }

  /** sRGB -> linear-light (the standard sRGB EOTF). Mirrors cvd-check.ts's srgbToLinear. */
  function srgbToLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /**
   * Linear sRGB -> OKLab, per Björn Ottosson's reference formulation
   * (https://bottosson.github.io/posts/oklab/ — "Converting from linear sRGB to
   * OKLab"). The two 3x3 matrices below are copied verbatim from that source: the
   * first maps linear sRGB to an LMS-like cone response, the second maps the
   * cube-rooted response to OKLab's L/a/b.
   */
  function linearSrgbToOklab([r, g, b]: readonly [number, number, number]): readonly [
    number,
    number,
    number,
  ] {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return [
      0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    ];
  }

  /** OKLab -> OKLCH: polar form. Hue in degrees, normalized to [0, 360). */
  function oklabToOklch([L, a, b]: readonly [number, number, number]): readonly [
    number,
    number,
    number,
  ] {
    const C = Math.sqrt(a * a + b * b);
    let H = (Math.atan2(b, a) * 180) / Math.PI;
    if (H < 0) H += 360;
    return [L, C, H];
  }

  /** hex -> OKLCH, as [L (0..1 fraction), C, H (degrees)]. */
  function hexToOklch(hex: string): readonly [number, number, number] {
    const linear = hexToSrgb(hex).map(srgbToLinear) as unknown as readonly [
      number,
      number,
      number,
    ];
    return oklabToOklch(linearSrgbToOklab(linear));
  }

  /** Parse a `oklch(L% C H)` string (the exact form tokens.ts/tokens.css use). */
  function parseOklch(oklch: string): readonly [number, number, number] {
    const m = oklch.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/);
    if (!m) throw new Error(`could not parse oklch string: "${oklch}"`);
    return [Number(m[1]) / 100, Number(m[2]), Number(m[3])];
  }

  /** The tolerances a hex/oklch pair must round-trip within — see rationale above. */
  const TOLERANCE = { l: 0.001, c: 0.001, h: 0.05 } as const;

  /** True iff `hex` and `oklch` encode the same color within TOLERANCE. */
  function isConsistentPair(hex: string, oklch: string): boolean {
    const [derivedL, derivedC, derivedH] = hexToOklch(hex);
    const [recordedL, recordedC, recordedH] = parseOklch(oklch);
    return (
      Math.abs(derivedL - recordedL) <= TOLERANCE.l &&
      Math.abs(derivedC - recordedC) <= TOLERANCE.c &&
      Math.abs(derivedH - recordedH) <= TOLERANCE.h
    );
  }

  test.each(Object.keys(palette) as TokenName[])(
    "palette.%s: hex converts to its recorded oklch within tolerance",
    (name) => {
      const { hex, oklch } = palette[name];
      expect(isConsistentPair(hex, oklch)).toBe(true);
    },
  );

  test("teeth: isConsistentPair rejects a deliberately mismatched pair", () => {
    // Same hex as players.oxide; oklch lightness bumped 10 points (56.25 -> 66.25),
    // ~1000x the rounding noise floor documented above.
    expect(isConsistentPair("#c0492f", "oklch(66.25% 0.1584 33.91)")).toBe(false);
  });

  test("teeth: isConsistentPair accepts a genuinely matching pair", () => {
    expect(isConsistentPair(players.oxide.hex, players.oxide.oklch)).toBe(true);
  });
});
