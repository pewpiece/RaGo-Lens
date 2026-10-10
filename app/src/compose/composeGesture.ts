import type { TransformState } from '@/edit/editState';
import { snapCentre, snapRotation, type CanvasSize } from './layout';

/** Two-finger state in preview px: centroid, finger distance and the angle of the line between them (radians). */
export interface Two {
  cx: number;
  cy: number;
  dist: number;
  angle: number;
}

export function two(a: { x: number; y: number }, b: { x: number; y: number }): Two {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    dist: Math.hypot(b.x - a.x, b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

const wrapDeg = (d: number): number => {
  let r = d;
  while (r > 180) r -= 360;
  while (r < -180) r += 360;
  return r;
};

export interface Guides {
  guideX: boolean;
  guideY: boolean;
  rotation: boolean;
}

/** One finger drags the product. `scale` is preview px per canvas px. */
export function applyDrag(
  t: TransformState,
  dx: number,
  dy: number,
  scale: number,
  canvas: CanvasSize,
): { t: TransformState; guides: Guides } {
  const cx = t.cx + dx / (scale * canvas.w);
  const cy = t.cy + dy / (scale * canvas.h);
  const s = snapCentre(cx, cy);
  return {
    t: { ...t, cx: s.cx, cy: s.cy },
    guides: { guideX: s.guideX, guideY: s.guideY, rotation: false },
  };
}

/** Two fingers pinch (scale), twist (rotate) and pan together. Rotation snaps to 0 / 90 / 180 / 270. */
export function applyTwo(
  t: TransformState,
  prev: Two,
  next: Two,
  scale: number,
  canvas: CanvasSize,
): { t: TransformState; guides: Guides } {
  const ratio = prev.dist > 4 ? next.dist / prev.dist : 1;
  const sc = Math.min(8, Math.max(0.05, t.scale * ratio));
  const rot = snapRotation(wrapDeg(t.rotation + ((next.angle - prev.angle) * 180) / Math.PI));
  const cx = t.cx + (next.cx - prev.cx) / (scale * canvas.w);
  const cy = t.cy + (next.cy - prev.cy) / (scale * canvas.h);
  const s = snapCentre(cx, cy);
  return {
    t: { ...t, scale: sc, rotation: rot.deg, cx: s.cx, cy: s.cy },
    guides: { guideX: s.guideX, guideY: s.guideY, rotation: rot.snapped },
  };
}

/** Nudge by `px` canvas pixels (arrow buttons). */
export function nudge(
  t: TransformState,
  dxPx: number,
  dyPx: number,
  canvas: CanvasSize,
): TransformState {
  return { ...t, cx: t.cx + dxPx / canvas.w, cy: t.cy + dyPx / canvas.h };
}

export const rotateBy = (t: TransformState, deg: number): TransformState => ({
  ...t,
  rotation: snapRotation(wrapDeg(t.rotation + deg), 0.001).deg,
});

export const resetTransform = (t: TransformState): TransformState => ({
  ...t,
  rotation: 0,
  flipH: false,
  flipV: false,
  scale: 1,
  cx: 0.5,
  cy: 0.5,
});
