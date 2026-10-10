import { BOUNDS_ALPHA_FLOOR } from '@/engine/postprocess';
import type { Box } from '@/compose/layout';
import type { TiledMask } from './tiledMask';

/**
 * Exact tight bounds of the mask on the full-resolution tiles (alpha above `floor`). Tiles that are entirely empty are
 * skipped without looking at a pixel; a 1 px feature (a crown, an antenna) is never lost. Null when the mask is empty.
 */
export function maskTightBounds(mask: TiledMask, floor = BOUNDS_ALPHA_FLOOR): Box | null {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (let i = 0; i < mask.tileCount; i++) {
    const u = mask.uniformValue(i);
    const tr = mask.tileRect(i);
    if (u !== null) {
      if (u > floor) {
        l = Math.min(l, tr.x);
        t = Math.min(t, tr.y);
        r = Math.max(r, tr.x + tr.w - 1);
        b = Math.max(b, tr.y + tr.h - 1);
      }
      continue;
    }
    const a = mask.getTile(i);
    for (let y = 0; y < tr.h; y++) {
      const row = y * tr.w;
      for (let x = 0; x < tr.w; x++) {
        if (a[row + x]! > floor) {
          if (tr.x + x < l) l = tr.x + x;
          if (tr.x + x > r) r = tr.x + x;
          if (tr.y + y < t) t = tr.y + y;
          if (tr.y + y > b) b = tr.y + y;
        }
      }
    }
  }
  return Number.isFinite(l) ? { left: l, top: t, right: r + 1, bottom: b + 1 } : null;
}
