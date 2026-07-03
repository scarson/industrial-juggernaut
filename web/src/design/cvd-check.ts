// ABOUTME: Pure color-science gate — WCAG contrast and colour-vision-deficiency separability.
// ABOUTME: No I/O, no DOM, no dependencies; the small matrix math lives here so it stays auditable.

// ---------------------------------------------------------------------------
// Colour-space conversions. sRGB is the web default; all perceptual math runs
// in linear-light RGB (or Lab), so every path linearizes first.
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

/** Parse `#rrggbb` (or `rrggbb`) into sRGB channels in [0, 1]. */
function hexToSrgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    throw new Error(`cvd-check: expected a #rrggbb hex color, got "${hex}"`);
  }
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** sRGB → linear-light (the standard sRGB EOTF). */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toLinear([r, g, b]: Rgb): Rgb {
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

// ---------------------------------------------------------------------------
// WCAG 2.1 contrast ratio.
//   relative luminance L = 0.2126·R + 0.7152·G + 0.0722·B (linear channels)
//   contrast = (L_light + 0.05) / (L_dark + 0.05)
// Reference: WCAG 2.1 §"relative luminance" and §"contrast ratio".
// ---------------------------------------------------------------------------

function relativeLuminance(hex: string): number {
  const [r, g, b] = toLinear(hexToSrgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two colors, in the range [1, 21].
 * Order-independent. AA body text requires >= 4.5.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

// ---------------------------------------------------------------------------
// Colour-vision-deficiency simulation — Machado, Oliveira & Fernandes (2009),
// "A Physiologically-based Model for Simulation of Color Vision Deficiency",
// IEEE Transactions on Visualization and Computer Graphics 15(6):1291–1298.
// The matrices below are the published severity = 1.0 (dichromacy) matrices and
// operate on LINEAR sRGB. Source table:
//   https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
// ---------------------------------------------------------------------------

type Matrix3 = readonly [Rgb, Rgb, Rgb];

const CVD_MATRICES: Record<Exclude<CvdType, "normal">, Matrix3> = {
  // Protanopia (L-cone absent).
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  // Deuteranopia (M-cone absent).
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  // Tritanopia (S-cone absent).
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** `"normal"` is the identity (unsimulated); the others are dichromacy sims. */
export type CvdType = "normal" | "protan" | "deutan" | "tritan";

function applyMatrix(m: Matrix3, [r, g, b]: Rgb): Rgb {
  return [
    m[0][0] * r + m[0][1] * g + m[0][2] * b,
    m[1][0] * r + m[1][1] * g + m[1][2] * b,
    m[2][0] * r + m[2][1] * g + m[2][2] * b,
  ];
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Simulate a color under a CVD type, returning linear-light RGB. */
function simulateLinear(hex: string, type: CvdType): Rgb {
  const linear = toLinear(hexToSrgb(hex));
  if (type === "normal") return linear;
  const [r, g, b] = applyMatrix(CVD_MATRICES[type], linear);
  return [clamp01(r), clamp01(g), clamp01(b)];
}

// ---------------------------------------------------------------------------
// CIELAB (D65) + CIE76 ΔE. CIE76 is the plain Euclidean distance in Lab; it is
// acceptable here because the separability threshold is calibrated against the
// actual palette (see cvd-check.test.ts) rather than assumed to equal a JND.
// ---------------------------------------------------------------------------

// D65 reference white (2° observer).
const WHITE_X = 0.95047;
const WHITE_Y = 1.0;
const WHITE_Z = 1.08883;

function linearToXyz([r, g, b]: Rgb): Rgb {
  // sRGB → XYZ (D65).
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

function labF(t: number): number {
  const delta = 6 / 29;
  return t > delta * delta * delta ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29;
}

function xyzToLab([x, y, z]: Rgb): Rgb {
  const fx = labF(x / WHITE_X);
  const fy = labF(y / WHITE_Y);
  const fz = labF(z / WHITE_Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Perceptual difference (CIE76 ΔE in CIELAB) between two colors as seen under a
 * given vision type. `"normal"` compares the colors directly; a CVD type
 * simulates both first, so the returned distance reflects how far apart a person
 * with that deficiency perceives them.
 */
export function cvdDeltaE(hexA: string, hexB: string, type: CvdType): number {
  const labA = xyzToLab(linearToXyz(simulateLinear(hexA, type)));
  const labB = xyzToLab(linearToXyz(simulateLinear(hexB, type)));
  return deltaE76(labA, labB);
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

/**
 * Minimum CIE76 ΔE at which two player colors count as "distinguishable" under
 * any vision type. See cvd-check.test.ts for the full rationale; briefly: 9.0 is
 * far above CIE76's ~2.3 just-noticeable difference (so the gate rejects
 * near-identical colors), and sits just under the fixed brief-committed
 * cobalt×violet deuteranopia floor (≈9.41) which no permitted palette can exceed.
 */
export const CVD_SEPARABILITY_THRESHOLD = 9.0;

const CVD_TYPES: readonly CvdType[] = ["normal", "protan", "deutan", "tritan"];

/**
 * True iff every pair in `hexes` stays at least CVD_SEPARABILITY_THRESHOLD apart
 * under normal vision AND under deuteranopia, protanopia, and tritanopia.
 * A single confusable pair under any one type fails the whole set.
 */
export function cvdSeparable(hexes: readonly string[]): boolean {
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      for (const type of CVD_TYPES) {
        if (cvdDeltaE(hexes[i]!, hexes[j]!, type) < CVD_SEPARABILITY_THRESHOLD) {
          return false;
        }
      }
    }
  }
  return true;
}
