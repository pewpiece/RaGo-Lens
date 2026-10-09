import type { MaskResult } from './types';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Smooth 0..1 step between edge0 and edge1. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export interface PostprocessOptions {
  /** Values below `low` become fully transparent, above `high` fully opaque, smooth in between. */
  low?: number;
  high?: number;
  /** Box-blur radius in mask pixels applied after thresholding (0 = off). */
  blurRadius?: number;
}

/**
 * Model output (float, roughly 0..1) -> clean 8-bit mask:
 * min-max normalise, soft threshold (keeps anti-aliased edges), light box blur.
 */
export function postprocessMask(
  output: ArrayLike<number>,
  width: number,
  height: number,
  { low = 0.12, high = 0.88, blurRadius = 1 }: PostprocessOptions = {},
): MaskResult {
  const n = width * height;
  if (output.length < n) throw new Error('postprocessMask: output is smaller than width*height');
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = output[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const soft = new Float32Array(n);
  if (range > 1e-8 && Number.isFinite(range)) {
    for (let i = 0; i < n; i++) soft[i] = smoothstep(low, high, (output[i]! - min) / range);
  } // else: flat output -> everything transparent (nothing detected)
  const blurred = blurRadius > 0 ? boxBlur(soft, width, height, blurRadius) : soft;
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = Math.round(clamp01(blurred[i]!) * 255);
  return { alpha, width, height };
}

/** Separable box blur with edge clamping. */
export function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[row + Math.min(width - 1, Math.max(0, x + k))]!;
      tmp[row + x] = s / span;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x]!;
      out[y * width + x] = s / span;
    }
  }
  return out;
}

export interface Bounds {
  left: number;
  top: number;
  /** Exclusive. */
  right: number;
  bottom: number;
}

/** Bounding box of pixels whose alpha is above `threshold`; null when the mask is empty. */
export function maskBounds(alpha: Uint8Array, width: number, height: number, threshold = 16): Bounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! > threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, top, right: right + 1, bottom: bottom + 1 };
}

/** Scale a bounds box between coordinate spaces, pad it, and clamp it into [0, w]x[0, h]. */
export function scaleAndPadBounds(
  b: Bounds,
  scaleX: number,
  scaleY: number,
  paddingPercent: number,
  outW: number,
  outH: number,
): Bounds {
  const left = b.left * scaleX;
  const right = b.right * scaleX;
  const top = b.top * scaleY;
  const bottom = b.bottom * scaleY;
  const pad = (Math.max(right - left, bottom - top) * paddingPercent) / 100;
  return {
    left: Math.max(0, Math.floor(left - pad)),
    top: Math.max(0, Math.floor(top - pad)),
    right: Math.min(outW, Math.ceil(right + pad)),
    bottom: Math.min(outH, Math.ceil(bottom + pad)),
  };
}

/**
 * CPU reference for applying a mask as the alpha channel of an RGBA image (same size).
 * Output alpha = round(imageAlpha * mask / 255); colour channels are untouched.
 * The on-device path does this on the GPU/Skia; this reference defines the expected result.
 */
export function applyMaskToRgba(rgba: Uint8Array, mask: Uint8Array): Uint8Array {
  if (rgba.length !== mask.length * 4) throw new Error('applyMaskToRgba: size mismatch');
  const out = new Uint8Array(rgba);
  for (let i = 0; i < mask.length; i++) {
    out[i * 4 + 3] = Math.round((rgba[i * 4 + 3]! * mask[i]!) / 255);
  }
  return out;
}

/** Bilinear resize of an 8-bit single-channel image (CPU reference / tests; device uses Skia). */
export function resizeMaskBilinear(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0]! * (1 - tx) + src[y0 * sw + x1]! * tx;
      const b = src[y1 * sw + x0]! * (1 - tx) + src[y1 * sw + x1]! * tx;
      out[y * dw + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return out;
}
