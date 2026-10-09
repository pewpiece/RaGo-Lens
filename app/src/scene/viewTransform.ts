import type { Point } from './strokes';

/** Maps image coordinates to screen: screen = image * scale + (x, y). */
export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export function fitTransform(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): ViewTransform {
  if (imgW <= 0 || imgH <= 0 || boxW <= 0 || boxH <= 0) return { scale: 1, x: 0, y: 0 };
  const scale = Math.min(boxW / imgW, boxH / imgH);
  return { scale, x: (boxW - imgW * scale) / 2, y: (boxH - imgH * scale) / 2 };
}

export const screenToImage = (t: ViewTransform, p: Point): Point => ({
  x: (p.x - t.x) / t.scale,
  y: (p.y - t.y) / t.scale,
});

export const imageToScreen = (t: ViewTransform, p: Point): Point => ({
  x: p.x * t.scale + t.x,
  y: p.y * t.scale + t.y,
});

export interface TwoFinger {
  cx: number;
  cy: number;
  dist: number;
}

export function twoFinger(a: Point, b: Point): TwoFinger {
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
}

/**
 * Pinch-to-zoom + two-finger pan. Keeps the image point under the previous centroid under the new centroid.
 * Zoom is clamped to [minScale, maxScale].
 */
export function applyPinch(
  t: ViewTransform,
  prev: TwoFinger,
  next: TwoFinger,
  minScale: number,
  maxScale: number,
): ViewTransform {
  const ratio = prev.dist > 1 ? next.dist / prev.dist : 1;
  const scale = Math.min(maxScale, Math.max(minScale, t.scale * ratio));
  const k = scale / t.scale;
  // image point under previous centroid: (prev.c - t.xy) / t.scale ; must land at next.c after scaling
  return {
    scale,
    x: next.cx - (prev.cx - t.x) * k,
    y: next.cy - (prev.cy - t.y) * k,
  };
}

/** Pans so that, when zoomed in, the image can't be dragged completely off the box. */
export function clampPan(
  t: ViewTransform,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): ViewTransform {
  const w = imgW * t.scale;
  const h = imgH * t.scale;
  const margin = 48;
  const clamp = (v: number, size: number, box: number) =>
    size <= box
      ? Math.min(Math.max(v, -margin), box - size + margin)
      : Math.min(margin, Math.max(box - size - margin, v));
  return { scale: t.scale, x: clamp(t.x, w, boxW), y: clamp(t.y, h, boxH) };
}
