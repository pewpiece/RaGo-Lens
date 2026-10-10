import { deltaEToRef } from './color';
import { edgeStepLimit } from './wand';

export interface SmartMatte {
  /** Working-copy box the matte covers. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0/255, w x h. */
  data: Uint8Array;
}

/**
 * Smart brush: where a stroke may act. For each brush position (a "dab") the colour under the centre is the reference;
 * a small flood fill, confined to the brush circle, collects the pixels that are similar to it and not separated from
 * the centre by a strong edge. The union over the whole stroke is the matte. Painting next to a boundary therefore does
 * not spill onto the other side. Runs on the small analysis copy and only inside the stroke's own area.
 */
export function smartMatte(
  lab: Float32Array,
  w: number,
  h: number,
  centres: { x: number; y: number }[],
  radius: number,
  tolerance: number,
  edgeSensitivity: number,
): SmartMatte {
  const rad = Math.max(1, radius);
  let x0 = w,
    y0 = h,
    x1 = 0,
    y1 = 0;
  for (const c of centres) {
    x0 = Math.min(x0, Math.floor(c.x - rad) - 2);
    y0 = Math.min(y0, Math.floor(c.y - rad) - 2);
    x1 = Math.max(x1, Math.ceil(c.x + rad) + 3);
    y1 = Math.max(y1, Math.ceil(c.y + rad) + 3);
  }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(w, x1);
  y1 = Math.min(h, y1);
  const mw = Math.max(0, x1 - x0);
  const mh = Math.max(0, y1 - y0);
  const data = new Uint8Array(mw * mh);
  if (mw === 0 || mh === 0) return { x: x0, y: y0, w: mw, h: mh, data };
  const tol2 = tolerance * tolerance;
  const step = edgeStepLimit(edgeSensitivity);
  const step2 = step * step;
  const seen = new Int32Array(mw * mh); // dab id that last visited a pixel
  const stack: number[] = [];
  let dab = 0;
  for (const c of centres) {
    dab++;
    const cx = Math.min(w - 1, Math.max(0, Math.round(c.x)));
    const cy = Math.min(h - 1, Math.max(0, Math.round(c.y)));
    const ref = [0, 0, 0];
    let n = 0;
    for (let y = Math.max(0, cy - 1); y <= Math.min(h - 1, cy + 1); y++)
      for (let x = Math.max(0, cx - 1); x <= Math.min(w - 1, cx + 1); x++) {
        const i = y * w + x;
        ref[0]! += lab[i * 3]!;
        ref[1]! += lab[i * 3 + 1]!;
        ref[2]! += lab[i * 3 + 2]!;
        n++;
      }
    ref[0] = ref[0]! / n;
    ref[1] = ref[1]! / n;
    ref[2] = ref[2]! / n;
    stack.length = 0;
    const start = (cy - y0) * mw + (cx - x0);
    if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1) continue;
    stack.push(cx, cy);
    seen[start] = dab;
    data[start] = 255;
    while (stack.length > 0) {
      const py = stack.pop()!;
      const px = stack.pop()!;
      const p = py * w + px;
      for (let k = 0; k < 4; k++) {
        const qx = px + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const qy = py + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (qx < x0 || qx >= x1 || qy < y0 || qy >= y1) continue;
        const mi = (qy - y0) * mw + (qx - x0);
        if (seen[mi] === dab) continue;
        if ((qx - c.x) ** 2 + (qy - c.y) ** 2 > rad * rad) continue;
        seen[mi] = dab;
        const q = qy * w + qx;
        if (deltaEToRef(lab, q, ref) ** 2 > tol2) continue;
        const dl = lab[q * 3]! - lab[p * 3]!;
        const da = lab[q * 3 + 1]! - lab[p * 3 + 1]!;
        const db = lab[q * 3 + 2]! - lab[p * 3 + 2]!;
        if (dl * dl + da * da + db * db > step2) continue;
        data[mi] = 255;
        stack.push(qx, qy);
      }
    }
  }
  return { x: x0, y: y0, w: mw, h: mh, data };
}

/** Brush positions along a polyline, at most `spacing` px apart (always includes both ends). */
export function dabsAlong(
  points: { x: number; y: number }[],
  spacing: number,
): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const out = [points[0]!];
  const sp = Math.max(1, spacing);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(d / sp);
    for (let k = 1; k <= n; k++)
      out.push({ x: a.x + ((b.x - a.x) * k * sp) / d, y: a.y + ((b.y - a.y) * k * sp) / d });
    out.push(b);
  }
  return out;
}
