import type { TransformState } from '@/edit/editState';
import { framingTransform, type Box, type CanvasSize } from './layout';

/**
 * The same framing for every product of a set, so a catalogue looks uniform: identical fill ratio, horizontal centre
 * and (optionally) the same baseline that every product stands on. Each item keeps its own rotation.
 */
export function frameSet(
  items: { bounds: Box; rotation: number }[],
  base: TransformState,
  canvas: CanvasSize,
  fill: number,
  mode: 'centre' | { baseline: number },
): TransformState[] {
  return items.map((it) =>
    framingTransform(it.bounds, { ...base, rotation: it.rotation }, canvas, fill, mode),
  );
}
