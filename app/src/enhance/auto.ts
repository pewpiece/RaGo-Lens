/**
 * Optional auto exposure and white balance. Pure maths on a small copy of the photo; the result is one 4x5 colour matrix
 * that can be applied to the model's working copy and, if chosen, to the exported picture (so what the model saw and what
 * is exported match). Strength 0 is the identity.
 */
export interface LevelStats {
  /** Luma (0..255) at the 1st and 99th percentile. */
  lo: number;
  hi: number;
  /** Per-channel gain that makes the mid-tones neutral (gray world), clamped. */
  gains: [number, number, number];
}

export const IDENTITY_MATRIX: readonly number[] = [
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
];

const MIN_SPAN = 40;
const GAIN_MIN = 0.8;
const GAIN_MAX = 1.25;
const STRETCH_MAX = 2.2;

export function analyseLevels(rgba: Uint8Array, w: number, h: number): LevelStats {
  const n = w * h;
  const step = Math.max(1, Math.floor(n / 200000));
  const hist = new Uint32Array(256);
  let cnt = 0;
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mc = 0;
  for (let i = 0; i < n; i += step) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    hist[l]++;
    cnt++;
    if (l >= 30 && l <= 225) {
      mr += r;
      mg += g;
      mb += b;
      mc++;
    }
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= cnt * p) return v;
    }
    return 255;
  };
  let lo = pct(0.01);
  let hi = pct(0.99);
  if (hi - lo < MIN_SPAN) {
    const mid = (hi + lo) / 2;
    lo = Math.max(0, mid - MIN_SPAN / 2);
    hi = Math.min(255, mid + MIN_SPAN / 2);
  }
  let gains: [number, number, number] = [1, 1, 1];
  if (mc > 50) {
    const r = mr / mc;
    const g = mg / mc;
    const b = mb / mc;
    const m = (r + g + b) / 3;
    const clamp = (v: number) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, v));
    gains = [clamp(m / Math.max(1, r)), clamp(m / Math.max(1, g)), clamp(m / Math.max(1, b))];
  }
  return { lo, hi, gains };
}

/** Skia colour matrix (rows R, G, B, A; offsets in 0..1) for the given stats and strength 0..1. */
export function enhanceMatrix(s: LevelStats, strength: number): number[] {
  const k = Math.min(1, Math.max(0, strength));
  if (k === 0) return [...IDENTITY_MATRIX];
  const stretch = Math.min(STRETCH_MAX, 255 / Math.max(MIN_SPAN, s.hi - s.lo));
  const kk = 1 + k * (stretch - 1);
  const off = (k * s.lo) / 255;
  const row = (g: number, i: number) => {
    const gg = 1 + k * (g - 1);
    const a = gg * kk;
    const r = [0, 0, 0, 0, -a * off];
    r[i] = a;
    return r;
  };
  return [...row(s.gains[0], 0), ...row(s.gains[1], 1), ...row(s.gains[2], 2), 0, 0, 0, 1, 0];
}

export const autoEnhanceMatrix = (
  rgba: Uint8Array,
  w: number,
  h: number,
  strength: number,
): number[] => enhanceMatrix(analyseLevels(rgba, w, h), strength);

export const isIdentity = (m: readonly number[]): boolean =>
  m.length === 20 && m.every((v, i) => Math.abs(v - IDENTITY_MATRIX[i]!) < 1e-6);

/** CPU reference of applying the matrix (tests; the app applies it with a Skia colour filter). */
export function applyMatrixToRgba(rgba: Uint8Array, m: readonly number[]): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    for (let c = 0; c < 3; c++) {
      const v = m[c * 5]! * r + m[c * 5 + 1]! * g + m[c * 5 + 2]! * b + m[c * 5 + 4]!;
      out[i + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    out[i + 3] = rgba[i + 3]!;
  }
  return out;
}
