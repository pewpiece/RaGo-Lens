/** How tightly the cut-out edge hugs the object. Soft keeps the model's feathered edge as is. */
export type EdgeLevel = 'soft' | 'normal' | 'tight';

export const EDGE_LEVELS: readonly EdgeLevel[] = ['soft', 'normal', 'tight'];
export const DEFAULT_EDGE: EdgeLevel = 'normal';

/**
 * Alpha ramp applied to the upscaled mask: alpha' = clamp((alpha - lo) / (hi - lo)).
 * Raising `lo` pulls the edge inwards and removes the faint rim of background the model leaves around dark
 * or low-contrast objects; the ramp keeps the edge anti-aliased.
 */
export function edgeRamp(level: EdgeLevel): { lo: number; hi: number } {
  switch (level) {
    case 'soft':
      return { lo: 0, hi: 1 };
    case 'tight':
      return { lo: 0.55, hi: 0.92 };
    default:
      return { lo: 0.3, hi: 0.85 };
  }
}

export function parseEdgeLevel(v: string | null | undefined): EdgeLevel {
  return v === 'soft' || v === 'tight' ? v : DEFAULT_EDGE;
}
