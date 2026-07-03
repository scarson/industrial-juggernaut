// ABOUTME: Machine-readable design tokens — the single source of truth for palette values.
// ABOUTME: tokens.css mirrors these for CSS consumption; the CVD/contrast gate asserts on these.

// This module is AUTHORITATIVE for raw palette values. tokens.css carries the
// OKLCH forms for the CSS cascade; this .ts carries the source hex the gate
// reads. When a value changes, change it here first, then update the matching
// custom property in tokens.css so the two stay consistent.
//
// The candidate hex come from the game-client UI brief
// (docs/superpowers/specs/2026-06-13-game-client-ui-brief.md §3). The three
// brief-committed player colors (oxide / cobalt / violet) are fixed; the three
// extension player colors (gold / steel / forest) were chosen to pass the CVD
// separability gate in cvd-check.test.ts — see that file for the rationale.

/** A named color: `hex` is the source value; `oklch` is the CSS custom-property form. */
export interface PaletteColor {
  readonly hex: string;
  readonly oklch: string;
}

function mk(hex: string, oklch: string): PaletteColor {
  return { hex, oklch };
}

// Chrome — "the Table": dark walnut/iron. Carries 30–60% of the screen (DESIGN.md).
export const chrome = {
  /** App body / deepest surface. */
  walnut900: mk("#241910", "oklch(22.44% 0.0241 60.42)"),
  /** Panels / toolbars — one step up (elevation via material layering, not shadow). */
  walnut800: mk("#2f2114", "oklch(26.10% 0.0311 63.66)"),
  /** Hairlines / raised chrome edges. */
  walnut700: mk("#3b2a19", "oklch(30.04% 0.0377 65.55)"),
} as const;

// Parchment — the board's material ONLY (the Parchment-Belongs-to-the-Board Rule).
export const parchment = {
  /** Aged map base — the darker end of the parchment range. */
  parchment300: mk("#d8c39c", "oklch(82.50% 0.0572 82.87)"),
  /** Lit map highlight — the lighter end. */
  parchment100: mk("#e6d8b8", "oklch(88.53% 0.0452 87.19)"),
} as const;

// Brass — the single scarce metallic accent (the Brass Budget Rule, ≤10%).
export const brass = {
  /** Default brass — selection, primary action. */
  brass500: mk("#b78d3c", "oklch(66.80% 0.1103 81.17)"),
  /** Brighter brass — hover/active glint; also clears AA on the darkest chrome. */
  brass400: mk("#c9a24e", "oklch(73.13% 0.1122 84.37)"),
} as const;

// Ink — text and linework, warm-black like printed cartography.
export const ink = {
  /** Body ink on parchment. */
  ink900: mk("#1a140d", "oklch(19.63% 0.0165 70.94)"),
  /** Muted ink — secondary linework / de-emphasized labels on parchment. */
  ink700: mk("#4a3d2c", "oklch(36.89% 0.0328 73.96)"),
} as const;

// Player identity set (6). Always paired with a redundant shape/marking — never
// color alone (PRODUCT.md CVD constraint). Committed 3 first, extension 3 after.
export const players = {
  /** Committed (brief): oxide-red. */
  oxide: mk("#c0492f", "oklch(56.25% 0.1584 33.91)"),
  /** Committed (brief): cobalt. */
  cobalt: mk("#2f6f9f", "oklch(52.27% 0.1000 244.20)"),
  /** Committed (brief): violet. */
  violet: mk("#6f4a86", "oklch(47.54% 0.1022 311.42)"),
  /** Extension: warm atlas gold — high-lightness yellow; deutan-robust by L* + b*. */
  gold: mk("#dcb43f", "oklch(78.52% 0.1383 89.48)"),
  /** Extension: weathered steel-slate — low-chroma blue-gray; separates by lightness. */
  steel: mk("#8fa9b5", "oklch(71.90% 0.0337 227.44)"),
  /** Extension: deep bottle-green — dark terrain tint; separates by lightness. */
  forest: mk("#3c5f45", "oklch(45.08% 0.0588 151.61)"),
} as const;

/** The six player colors, ordered committed-then-extension. The CVD gate reads this. */
export const playerColors: readonly PaletteColor[] = [
  players.oxide,
  players.cobalt,
  players.violet,
  players.gold,
  players.steel,
  players.forest,
] as const;

/** Every named token, flattened, for iteration/verification. */
export const palette = {
  ...chrome,
  ...parchment,
  ...brass,
  ...ink,
  ...players,
} as const;

export type TokenName = keyof typeof palette;

/**
 * The CSS custom-property reference for a token, e.g. `color("walnut900")`
 * returns `"var(--color-walnut-900)"`. Consumers style with this so the CSS
 * cascade (and any future theming) stays the single runtime authority.
 */
export function color(name: TokenName): string {
  return `var(--color-${cssVarSuffix(name)})`;
}

/** Maps a camelCase token name to its kebab-case CSS custom-property suffix. */
function cssVarSuffix(name: TokenName): string {
  // Only inserts a hyphen at the letter→digit boundary (walnut900 -> walnut-900;
  // parchment300 -> parchment-300; single-word names like oxide pass through). It
  // does NOT split camelCase words — token names here are word+number or a single
  // word by construction, so that is the only boundary that occurs.
  return name.replace(/([a-z])(\d)/g, "$1-$2");
}
