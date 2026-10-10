import type { SkImage } from '@shopify/react-native-skia';
import { resizeImage } from '@/engine/skiaOps';

/** Level k is the photo at 1/2^k size. Picks the smallest level that still has at least one image pixel per screen pixel. */
export function pickLevel(viewScale: number, levels: number): number {
  let k = 0;
  while (k < levels - 1 && 1 / 2 ** (k + 1) >= viewScale) k++;
  return k;
}

/**
 * A mip chain of the photo, built lazily. Drawing a 12 MP photo scaled to a phone screen from level 0 makes the GPU
 * sample across many source pixels (shimmer while zooming); a smaller level is both sharper and cheaper.
 * Level images are drawn stretched to the photo's full size by the caller.
 */
export class ImagePyramid {
  private readonly cache = new Map<number, SkImage>();
  readonly levels: number;

  constructor(
    private readonly base: SkImage,
    minEdge = 256,
  ) {
    let k = 1;
    while (Math.max(base.width(), base.height()) / 2 ** k >= minEdge) k++;
    this.levels = k;
  }

  level(k: number): SkImage {
    if (k <= 0) return this.base;
    const hit = this.cache.get(k);
    if (hit) return hit;
    const s = 2 ** k;
    const img = resizeImage(
      this.base,
      Math.max(1, Math.round(this.base.width() / s)),
      Math.max(1, Math.round(this.base.height() / s)),
    );
    this.cache.set(k, img);
    return img;
  }

  /** The image to draw at this view scale. */
  forScale(viewScale: number): SkImage {
    return this.level(pickLevel(viewScale, this.levels));
  }

  dispose(): void {
    this.cache.clear();
  }
}
