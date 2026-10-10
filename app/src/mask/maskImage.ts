import { AlphaType, ColorType, type SkImage } from '@shopify/react-native-skia';
import { alpha8Image } from '@/engine/skiaOps';
import { TILE, TiledMask } from './tiledMask';

/**
 * Reads the alpha channel of any decoded image into a TiledMask, one tile at a time (so a 12 MP mask never needs a
 * 48 MB RGBA copy in JavaScript). Used once, when a stored mask is opened.
 */
export function maskFromImage(img: SkImage): TiledMask {
  const m = new TiledMask(img.width(), img.height(), 0);
  for (let i = 0; i < m.tileCount; i++) {
    const r = m.tileRect(i);
    const px = img.readPixels(r.x, r.y, {
      width: r.w,
      height: r.h,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!px) throw new Error('Could not read the mask');
    const rgba = px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
    const tile = new Uint8Array(r.w * r.h);
    for (let k = 0; k < tile.length; k++) tile[k] = rgba[k * 4 + 3]!;
    m.setTile(i, tile);
  }
  return m;
}

/** One tile as an Alpha_8 image (what the editor draws; also the unit the Skia compositing ops work on). */
export function tileImage(mask: TiledMask, index: number): SkImage {
  const r = mask.tileRect(index);
  return alpha8Image(mask.getTile(index), r.w, r.h);
}

/** The whole mask as one Alpha_8 image (1 byte per pixel), e.g. for export and for saving as a PNG. */
export function maskToImage(mask: TiledMask): SkImage {
  return alpha8Image(mask.toFlat(), mask.width, mask.height);
}

/** Per-tile image cache keyed by tile version, so only edited tiles are re-uploaded. */
export class TileImageCache {
  private readonly entries = new Map<number, { version: number; image: SkImage }>();
  constructor(private readonly mask: TiledMask) {}

  get(index: number): SkImage {
    const v = this.mask.version(index);
    const hit = this.entries.get(index);
    if (hit && hit.version === v) return hit.image;
    const image = tileImage(this.mask, index);
    this.entries.set(index, { version: v, image });
    return image;
  }

  /** Tiles that are fully 0 need not be drawn at all (and are never uploaded). */
  isEmpty(index: number): boolean {
    return this.mask.uniformValue(index) === 0;
  }

  clear(): void {
    this.entries.clear();
  }
}

export { TILE };
