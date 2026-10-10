import type { ViewTransform } from '@/scene/viewTransform';

/** How far above the finger the brush is drawn while the loupe is on, so the finger never hides the edit. */
export const loupeOffset = (brushScreenSize: number): number =>
  Math.max(64, brushScreenSize / 2 + 40);

/** The brush position (screen px) for a finger at `touch`. */
export function brushPoint(
  touch: { x: number; y: number },
  brushScreenSize: number,
  loupe: boolean,
) {
  return loupe ? { x: touch.x, y: touch.y - loupeOffset(brushScreenSize) } : touch;
}

/** The loupe's own view: the same photo magnified `zoom` times, centred on `at` (screen px of the main view). */
export function loupeView(
  main: ViewTransform,
  at: { x: number; y: number },
  size: number,
  zoom: number,
): ViewTransform {
  const px = (at.x - main.x) / main.scale;
  const py = (at.y - main.y) / main.scale;
  const scale = main.scale * zoom;
  return { scale, x: size / 2 - px * scale, y: size / 2 - py * scale };
}
