import { Skia, type SkImage } from '@shopify/react-native-skia';
import { sampleRgba } from '@/engine/skiaOps';

export interface Stretch {
  lo: number;
  hi: number;
}

/**
 * Black and white points for a contrast stretch: the 2nd and 98th percentile of the luminance, so a few
 * specks or a glare patch do not decide the range. Always returns at least `minSpan` levels apart.
 */
export function stretchRange(
  luminance: Uint8Array | number[],
  lowPct = 0.02,
  highPct = 0.98,
  minSpan = 12,
): Stretch {
  if (luminance.length === 0) return { lo: 0, hi: 255 };
  const hist = new Uint32Array(256);
  for (let i = 0; i < luminance.length; i++)
    hist[Math.max(0, Math.min(255, Math.round(luminance[i]!)))]++;
  const find = (target: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= target) return v;
    }
    return 255;
  };
  let lo = find(luminance.length * lowPct);
  let hi = find(luminance.length * highPct);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = Math.max(0, Math.round(mid - minSpan / 2));
    hi = Math.min(255, lo + minSpan);
  }
  return { lo, hi };
}

/** 4x5 colour matrix (offsets in 0..1) that converts to grey and stretches [lo, hi] to [0, 255]. */
export function stretchMatrix({ lo, hi }: Stretch): number[] {
  const span = Math.max(1, hi - lo) / 255;
  const off = -(lo / 255) / span;
  const r = 0.299 / span;
  const g = 0.587 / span;
  const b = 0.114 / span;
  return [r, g, b, 0, off, r, g, b, 0, off, r, g, b, 0, off, 0, 0, 0, 1, 0];
}

/**
 * Makes faint pencil or pen on tinted paper readable: grey-scale plus an automatic contrast stretch.
 * The photo is not altered, a new image is returned (used only as input to text recognition).
 */
export function enhanceForOcr(src: SkImage): SkImage {
  const w = src.width();
  const h = src.height();
  const sw = 256;
  const sh = Math.max(1, Math.round((sw * h) / w));
  const rgba = sampleRgba(src, sw, sh);
  const lum = new Uint8Array(sw * sh);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!);
  }
  const range = stretchRange(lum);
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('Out of memory: could not allocate drawing surface');
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(stretchMatrix(range)));
  surface.getCanvas().drawImage(src, 0, 0, paint);
  surface.flush?.();
  return surface.makeImageSnapshot();
}
