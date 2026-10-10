import type { SkImage } from '@shopify/react-native-skia';
import { sampleRgba, alpha8Image } from '@/engine/skiaOps';
import type { EditSession } from '@/mask/history';
import { labOf } from './color';
import { dabsAlong, smartMatte } from './smartBrush';
import { applyStroke, type BrushStroke } from './tileOps';

/** A small (<= ~1 MP) copy of the photo for colour analysis: wand, smart brush, clean-up suggestions. */
export interface Analysis {
  w: number;
  h: number;
  /** Full-res px per analysis px. */
  kx: number;
  ky: number;
  rgba: Uint8Array;
  lab: Float32Array;
}

export const ANALYSIS_EDGE = 1024;

export function makeAnalysis(photo: SkImage, maxEdge = ANALYSIS_EDGE): Analysis {
  const k = Math.min(1, maxEdge / Math.max(photo.width(), photo.height()));
  const w = Math.max(1, Math.round(photo.width() * k));
  const h = Math.max(1, Math.round(photo.height() * k));
  const rgba = sampleRgba(photo, w, h);
  return { w, h, kx: photo.width() / w, ky: photo.height() / h, rgba, lab: labOf(rgba, w, h) };
}

/** Smart brush: the stroke acts only on pixels that look like the colour under the brush and do not cross a strong edge. */
export function applySmartStroke(
  mask: Parameters<typeof applyStroke>[0],
  s: BrushStroke,
  a: Analysis,
  opts: { tolerance: number; edgeSensitivity: number },
  session: EditSession | null,
): number[] {
  const radius = s.size / 2 / a.kx;
  const centres = dabsAlong(s.points, Math.max(1, radius * 0.5)).map((p) => ({
    x: p.x / a.kx,
    y: p.y / a.ky,
  }));
  const m = smartMatte(a.lab, a.w, a.h, centres, radius, opts.tolerance, opts.edgeSensitivity);
  if (m.w === 0 || m.h === 0) return [];
  const image = alpha8Image(m.data, m.w, m.h);
  return applyStroke(mask, s, session, {
    image,
    dest: { x: m.x * a.kx, y: m.y * a.ky, w: m.w * a.kx, h: m.h * a.ky },
  });
}
