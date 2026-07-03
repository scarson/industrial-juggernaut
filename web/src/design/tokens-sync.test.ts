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
