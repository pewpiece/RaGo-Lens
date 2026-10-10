import { rgbToLab } from './color';

export interface WandOptions {
  /** CIE76 colour distance from the tapped colour that still counts as "the same", 1..100. */
  tolerance: number;
  /** Only pixels connected to the tap (true), or every similar pixel in the image (false). */
  contiguous: boolean;
  /** Refuse to cross a strong edge (a sudden colour step between neighbouring pixels). */
  edgeAware: boolean;
  /** 0..1: higher stops at weaker edges. */
  edgeSensitivity: number;
  /** When given, selection is confined to pixels where this is > 127 ("current cutout only"). */
  restrictTo?: Uint8Array;
}

export const DEFAULT_WAND: WandOptions = {
  tolerance: 18,
  contiguous: true,
  edgeAware: true,
  edgeSensitivity: 0.5,
};

/** The colour step between neighbours above which an edge-aware fill stops (CIE76 units). */
export const edgeStepLimit = (sensitivity: number): number => {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 28 - s * 24; // 0 -> 28 (only very hard edges stop it), 1 -> 4
};

/**
 * Magic wand in Lab colour space on a small working copy. Returns a 0/255 selection the same size.
 * The reference colour is the mean of a 3x3 neighbourhood at the tap (robust against sensor noise).
 */
export function magicWand(
  lab: Float32Array,
  w: number,
  h: number,
  seed: { x: number; y: number },
  o: WandOptions = DEFAULT_WAND,
): Uint8Array {
  const out = new Uint8Array(w * h);
  const sx = Math.min(w - 1, Math.max(0, Math.round(seed.x)));
  const sy = Math.min(h - 1, Math.max(0, Math.round(seed.y)));
  const inside = (i: number) => !o.restrictTo || o.restrictTo[i]! > 127;
  const si = sy * w + sx;
  if (!inside(si)) return out;
  // reference colour: 3x3 mean
  const ref = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, sy - 1); y <= Math.min(h - 1, sy + 1); y++)
    for (let x = Math.max(0, sx - 1); x <= Math.min(w - 1, sx + 1); x++) {
      const i = y * w + x;
      if (!inside(i)) continue;
      ref[0]! += lab[i * 3]!;
      ref[1]! += lab[i * 3 + 1]!;
      ref[2]! += lab[i * 3 + 2]!;
      n++;
    }
  ref[0] = ref[0]! / n;
  ref[1] = ref[1]! / n;
  ref[2] = ref[2]! / n;
  const tol2 = o.tolerance * o.tolerance;
  const step = edgeStepLimit(o.edgeSensitivity);
  const step2 = step * step;
  const r0 = ref[0]!;
  const r1 = ref[1]!;
  const r2 = ref[2]!;
  if (!o.contiguous) {
    for (let i = 0; i < w * h; i++) {
      if (!inside(i)) continue;
      const dl = lab[i * 3]! - r0;
      const da = lab[i * 3 + 1]! - r1;
      const db = lab[i * 3 + 2]! - r2;
      if (dl * dl + da * da + db * db <= tol2) out[i] = 255;
    }
    return out;
  }
  // state: 0 untested, 1 selected, 2 rejected for colour (permanent; an edge rejection can be retried from another side)
  const state = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  stack[sp++] = si;
  state[si] = 1;
  out[si] = 255;
  const tryPush = (p: number, q: number) => {
    if (state[q]) return;
    if (!inside(q)) {
      state[q] = 2;
      return;
    }
    const dl = lab[q * 3]! - r0;
    const da = lab[q * 3 + 1]! - r1;
    const db = lab[q * 3 + 2]! - r2;
    if (dl * dl + da * da + db * db > tol2) {
      state[q] = 2;
      return;
    }
    if (o.edgeAware) {
      const el = lab[q * 3]! - lab[p * 3]!;
      const ea = lab[q * 3 + 1]! - lab[p * 3 + 1]!;
      const eb = lab[q * 3 + 2]! - lab[p * 3 + 2]!;
      if (el * el + ea * ea + eb * eb > step2) return;
    }
    state[q] = 1;
    out[q] = 255;
    stack[sp++] = q;
  };
  while (sp > 0) {
    const p = stack[--sp]!;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) tryPush(p, p - 1);
    if (x < w - 1) tryPush(p, p + 1);
    if (y > 0) tryPush(p, p - w);
    if (y < h - 1) tryPush(p, p + w);
  }
  return out;
}

/** Convenience for tests and callers holding RGBA. */
export function labFromRgbaPixel(r: number, g: number, b: number): [number, number, number] {
  const o: number[] = [0, 0, 0];
  rgbToLab(r, g, b, o);
  return [o[0]!, o[1]!, o[2]!];
}
