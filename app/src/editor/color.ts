/** sRGB -> CIE Lab (D65) and colour difference. Used by the wand, smart brush and clean-up analysis on a small working copy. */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(
  r: number,
  g: number,
  b: number,
  out: Float32Array | number[],
  o = 0,
): void {
  const lr = LIN[r]!;
  const lg = LIN[g]!;
  const lb = LIN[b]!;
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / XN;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / YN;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / ZN;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

/** Interleaved L,a,b floats for an RGBA image. */
export function labOf(rgba: Uint8Array, w: number, h: number): Float32Array {
  const lab = new Float32Array(w * h * 3);
  for (let i = 0, p = 0; i < w * h; i++, p += 4)
    rgbToLab(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!, lab, i * 3);
  return lab;
}

/** CIE76 colour difference between pixels i and j of a lab image. */
export const deltaE = (lab: Float32Array, i: number, j: number): number => {
  const dl = lab[i * 3]! - lab[j * 3]!;
  const da = lab[i * 3 + 1]! - lab[j * 3 + 1]!;
  const db = lab[i * 3 + 2]! - lab[j * 3 + 2]!;
  return Math.sqrt(dl * dl + da * da + db * db);
};

export const deltaEToRef = (lab: Float32Array, i: number, ref: ArrayLike<number>): number => {
  const dl = lab[i * 3]! - ref[0]!;
  const da = lab[i * 3 + 1]! - ref[1]!;
  const db = lab[i * 3 + 2]! - ref[2]!;
  return Math.sqrt(dl * dl + da * da + db * db);
};

/** Mean Lab of the pixels where `flag` is non-zero; null when none. */
export function meanLab(
  lab: Float32Array,
  flag: Uint8Array,
  n: number,
): [number, number, number] | null {
  let l = 0;
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (flag[i]) {
      l += lab[i * 3]!;
      a += lab[i * 3 + 1]!;
      b += lab[i * 3 + 2]!;
      c++;
    }
  }
  return c === 0 ? null : [l / c, a / c, b / c];
}

export const labDistance = (p: ArrayLike<number>, q: ArrayLike<number>): number =>
  Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
