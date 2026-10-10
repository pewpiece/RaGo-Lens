import type { CanvasState, TransformState } from '@/edit/editState';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const boxW = (b: Box) => b.right - b.left;
export const boxH = (b: Box) => b.bottom - b.top;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Size of the axis-aligned box that contains a w x h rectangle rotated by `deg`. */
export function rotatedExtent(w: number, h: number, deg: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(rad(deg)));
  const s = Math.abs(Math.sin(rad(deg)));
  return { w: w * c + h * s, h: w * s + h * c };
}

export interface CanvasSize {
  w: number;
  h: number;
}

/**
 * Output canvas size in px.
 *  - 'original': the product's own pixels (1 photo px = 1 output px at scale 1) plus padding, exactly the size the
 *    photo can deliver, never smaller than the product and never enlarged.
 *  - everything else: the chosen width x height.
 */
export function canvasSizeFor(c: CanvasState, bounds: Box, rotationDeg: number): CanvasSize {
  if (c.aspect === 'original') {
    const e = rotatedExtent(boxW(bounds), boxH(bounds), rotationDeg);
    const pad = (Math.max(e.w, e.h) * c.paddingPercent) / 100;
    return {
      w: Math.max(1, Math.ceil(e.w + 2 * pad - 1e-6)),
      h: Math.max(1, Math.ceil(e.h + 2 * pad - 1e-6)),
    };
  }
  return { w: Math.max(1, Math.round(c.width)), h: Math.max(1, Math.round(c.height)) };
}

export const ASPECTS: Record<string, [number, number]> = {
  '1:1': [1, 1],
  '4:5': [4, 5],
  '3:4': [3, 4],
  '16:9': [16, 9],
  '9:16': [9, 16],
};

/** width x height for an aspect with the given long side. */
export function sizeForAspect(aspect: keyof typeof ASPECTS, longSide: number): CanvasSize {
  const [a, b] = ASPECTS[aspect]!;
  return a >= b
    ? { w: Math.round(longSide), h: Math.round((longSide * b) / a) }
    : { w: Math.round((longSide * a) / b), h: Math.round(longSide) };
}

export interface Placement {
  /** Output pixels per photo pixel. */
  k: number;
  /** Product centre on the canvas, px. */
  cx: number;
  cy: number;
  deg: number;
  flipH: boolean;
  flipV: boolean;
  /** Where the product lands (axis-aligned box on the canvas, px). */
  box: Box;
}

/**
 * Where the product goes on the canvas.
 * `fill` is the share of the canvas the product should take along its tighter axis at scale 1 (e.g. 0.85); null means
 * "natural size" (1 photo px = 1 output px at scale 1), used for the 'original' canvas.
 */
export function placeProduct(
  bounds: Box,
  t: TransformState,
  canvas: CanvasSize,
  fill: number | null,
): Placement {
  const e = rotatedExtent(boxW(bounds), boxH(bounds), t.rotation);
  const k0 = fill === null ? 1 : fill / Math.max(e.w / canvas.w, e.h / canvas.h);
  const k = Math.max(1e-6, k0 * t.scale);
  const cx = t.cx * canvas.w;
  const cy = t.cy * canvas.h;
  return {
    k,
    cx,
    cy,
    deg: t.rotation,
    flipH: t.flipH,
    flipV: t.flipV,
    box: {
      left: cx - (e.w * k) / 2,
      top: cy - (e.h * k) / 2,
      right: cx + (e.w * k) / 2,
      bottom: cy + (e.h * k) / 2,
    },
  };
}

/** Skia transform list that maps photo coordinates onto the canvas for a placement. */
export function placementTransform(p: Placement, bounds: Box) {
  const bx = (bounds.left + bounds.right) / 2;
  const by = (bounds.top + bounds.bottom) / 2;
  return [
    { translateX: p.cx },
    { translateY: p.cy },
    { rotate: rad(p.deg) },
    { scaleX: p.k * (p.flipH ? -1 : 1) },
    { scaleY: p.k * (p.flipV ? -1 : 1) },
    { translateX: -bx },
    { translateY: -by },
  ];
}

/** Snaps a rotation to 0 / 90 / 180 / 270 (and -90 / -180) within `tol` degrees. */
export function snapRotation(deg: number, tol = 3): { deg: number; snapped: boolean } {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  for (const target of [-180, -90, 0, 90, 180]) {
    if (Math.abs(d - target) <= tol) return { deg: target === -180 ? 180 : target, snapped: true };
  }
  return { deg: d, snapped: false };
}

/** Snaps the product centre to the canvas centre lines (fractions); reports which guide to draw. */
export function snapCentre(
  cx: number,
  cy: number,
  tol = 0.015,
): { cx: number; cy: number; guideX: boolean; guideY: boolean } {
  const gx = Math.abs(cx - 0.5) <= tol;
  const gy = Math.abs(cy - 0.5) <= tol;
  return { cx: gx ? 0.5 : cx, cy: gy ? 0.5 : cy, guideX: gx, guideY: gy };
}

/**
 * The transform that gives a product the target fill ratio and centres it (or sits it on a baseline).
 * scale stays 1 because the fill is already part of the placement; it only resets any manual zoom.
 */
export function framingTransform(
  bounds: Box,
  base: TransformState,
  canvas: CanvasSize,
  fill: number,
  mode: 'centre' | { baseline: number },
): TransformState {
  const e = rotatedExtent(boxW(bounds), boxH(bounds), base.rotation);
  const k = fill / Math.max(e.w / canvas.w, e.h / canvas.h);
  const cy = mode === 'centre' ? 0.5 : (mode.baseline * canvas.h - (e.h * k) / 2) / canvas.h;
  return { ...base, scale: 1, cx: 0.5, cy };
}

/** Measures how a placed product sits in the canvas (used by the readiness checks and tests). */
export function framingStats(box: Box, canvas: CanvasSize) {
  const w = boxW(box);
  const h = boxH(box);
  return {
    fill: Math.max(w / canvas.w, h / canvas.h),
    centreOffsetX: (box.left + box.right) / 2 / canvas.w - 0.5,
    centreOffsetY: (box.top + box.bottom) / 2 / canvas.h - 0.5,
    marginLeft: box.left / canvas.w,
    marginRight: (canvas.w - box.right) / canvas.w,
    marginTop: box.top / canvas.h,
    marginBottom: (canvas.h - box.bottom) / canvas.h,
  };
}
