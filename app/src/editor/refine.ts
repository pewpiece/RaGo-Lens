import { AlphaType, ColorType, Skia, TileMode, type SkImage } from '@shopify/react-native-skia';
import { alpha8Image, readAlpha, tightenMask } from '@/engine/skiaOps';
import type { RefineState } from '@/edit/editState';
import { TiledMask, type Rect } from '@/mask/tiledMask';
import { refineMatte } from './matting';
import { readRgbaRegion } from './tileOps';

/**
 * Edge quality at full resolution, tile by tile with an overlapping margin so there are no seams:
 *   matting (trimap + local colour line, resolved against the real photo pixels)  ->  shift  ->  smooth  ->  soften.
 * Tiles whose neighbourhood is entirely 0 or entirely 255 are skipped, so the work scales with the object's edge, not with
 * the image area. Shift / smooth / soften use Skia image filters; the matting loops only over band pixels.
 */
export const DEFAULT_REFINE: RefineState = {
  softness: 0,
  shift: 0,
  smooth: 0,
  fineDetail: false,
  decontaminate: true,
};

export const isDefaultRefine = (r: RefineState): boolean =>
  r.softness === 0 && r.shift === 0 && r.smooth === 0 && !r.fineDetail;

/** Band needed to cover a model mask that was upscaled by `ratio` (photo long side / mask long side). */
export const bandRadiusForUpscale = (ratio: number): number =>
  Math.min(24, Math.max(2, Math.ceil(ratio * 0.8)));

/** Half width of the uncertain band, scaled to the photo (about 0.3 % of the long side, 2..12 px; wider for fine detail). */
export function bandRadiusFor(width: number, height: number, fineDetail: boolean): number {
  const r = Math.round(Math.max(width, height) * 0.003);
  return Math.min(12, Math.max(2, fineDetail ? r * 2 : r));
}

const marginFor = (s: RefineState, bandR: number): number =>
  Math.min(
    72,
    Math.ceil(Math.max(bandR * 3, Math.abs(s.shift) + 2, s.smooth * 3 + 2, s.softness * 3 + 2)),
  );

function regionAround(m: TiledMask, index: number, margin: number): { tile: Rect; reg: Rect } {
  const tile = m.tileRect(index);
  const x = Math.max(0, tile.x - margin);
  const y = Math.max(0, tile.y - margin);
  return {
    tile,
    reg: {
      x,
      y,
      w: Math.min(m.width, tile.x + tile.w + margin) - x,
      h: Math.min(m.height, tile.y + tile.h + margin) - y,
    },
  };
}

function hasEdge(a: Uint8Array): boolean {
  let lo = false;
  let hi = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < 255) lo = true;
    if (a[i]! > 0) hi = true;
    if (lo && hi) return true;
  }
  return false;
}

function pass(
  img: SkImage,
  w: number,
  h: number,
  setup: (p: ReturnType<typeof Skia.Paint>) => void,
): SkImage {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('Out of memory: could not allocate a refinement surface');
  const p = Skia.Paint();
  p.setColor(Skia.Color('white'));
  setup(p);
  surface.getCanvas().drawImage(img, 0, 0, p);
  surface.flush?.();
  return surface.makeImageSnapshot();
}

/** shift (dilate/erode) -> smooth (blur + re-threshold) -> soften (blur) on one alpha region, all in Skia. */
export function shapeAlpha(alpha: Uint8Array, w: number, h: number, s: RefineState): Uint8Array {
  let img = alpha8Image(alpha, w, h);
  if (s.shift !== 0) {
    const r = Math.abs(s.shift);
    img = pass(img, w, h, (p) =>
      p.setImageFilter(
        s.shift > 0
          ? Skia.ImageFilter.MakeDilate(r, r, null)
          : Skia.ImageFilter.MakeErode(r, r, null),
      ),
    );
  }
  if (s.smooth > 0 && !s.fineDetail) {
    img = pass(img, w, h, (p) =>
      p.setImageFilter(Skia.ImageFilter.MakeBlur(s.smooth / 2, s.smooth / 2, TileMode.Clamp, null)),
    );
    // blur rounds the contour; pulling the ramp back to 0.5 keeps the edge where it was but makes it clean
    img = tightenMask(img, 0.35, 0.65);
  }
  if (s.softness > 0) {
    img = pass(img, w, h, (p) =>
      p.setImageFilter(
        Skia.ImageFilter.MakeBlur(s.softness / 2, s.softness / 2, TileMode.Clamp, null),
      ),
    );
  }
  return readAlpha(img);
}

export interface RefineOptions {
  /** Resolve the uncertain band against the photo (matting). On for new cut-outs and for any refine preview/export. */
  matte?: boolean;
  /**
   * Half width of the uncertain band in photo px. Must cover how far the mask can be off: a model mask that was
   * upscaled by k is wrong by up to ~k px at the edge. Default: bandRadiusFor(photo size).
   */
  bandRadius?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Refines a whole mask. Returns a new TiledMask; the input is not modified. */
export function refineMask(
  original: SkImage,
  base: TiledMask,
  s: RefineState,
  o: RefineOptions = {},
): TiledMask {
  const out = base.clone();
  const bandR = o.bandRadius ?? bandRadiusFor(base.width, base.height, s.fineDetail);
  const margin = marginFor(s, bandR);
  for (let i = 0; i < base.tileCount; i++) {
    if (o.signal?.aborted) throw new Error('Cancelled');
    o.onProgress?.(i / base.tileCount);
    const { tile, reg } = regionAround(base, i, margin);
    const a = base.readRegion(reg);
    if (!hasEdge(a)) continue;
    let region = a;
    if (o.matte !== false) {
      const rgba = readRgbaRegion(original, reg);
      region = refineMatte(rgba, region, reg.w, reg.h, {
        bandRadius: bandR,
        lowContrast: s.fineDetail ? 6 : 10,
        trustDistance: s.fineDetail ? 40 : 50,
      }).alpha;
    }
    if (s.shift !== 0 || s.smooth > 0 || s.softness > 0)
      region = shapeAlpha(region, reg.w, reg.h, s);
    const t = new Uint8Array(tile.w * tile.h);
    for (let y = 0; y < tile.h; y++) {
      const src = (tile.y - reg.y + y) * reg.w + (tile.x - reg.x);
      t.set(region.subarray(src, src + tile.w), y * tile.w);
    }
    out.setTile(i, t);
  }
  o.onProgress?.(1);
  return out;
}

/** A replacement for part of the photo: opaque RGBA at (x, y), drawn over the photo before the mask is applied. */
export interface PhotoPatch {
  image: SkImage;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Colour decontamination for the final mask: for each tile with semi-transparent edge pixels, the edge colours are
 * replaced by the estimated true foreground colour, so no halo of the old background (white, green, black) survives
 * in the exported edge. Returns patches to draw over the photo; the photo itself is never modified.
 */
export function decontaminationPatches(
  original: SkImage,
  mask: TiledMask,
  o: { signal?: AbortSignal } = {},
): PhotoPatch[] {
  const bandR = bandRadiusFor(mask.width, mask.height, false);
  const margin = bandR * 3;
  const patches: PhotoPatch[] = [];
  for (let i = 0; i < mask.tileCount; i++) {
    if (o.signal?.aborted) throw new Error('Cancelled');
    if (mask.uniformValue(i) !== null && mask.uniformValue(i) !== 0 && mask.uniformValue(i) !== 255)
      continue;
    const { tile, reg } = regionAround(mask, i, margin);
    const a = mask.readRegion(reg);
    if (!hasEdge(a)) continue;
    const rgba = readRgbaRegion(original, reg);
    const m = refineMatte(rgba, a, reg.w, reg.h, { bandRadius: bandR, keepAlpha: true });
    // copy the tile's pixels, replacing colours inside the band of semi-transparent pixels
    const px = new Uint8Array(tile.w * tile.h * 4);
    let changed = false;
    for (let y = 0; y < tile.h; y++) {
      for (let x = 0; x < tile.w; x++) {
        const ri = (tile.y - reg.y + y) * reg.w + (tile.x - reg.x + x);
        const o4 = (y * tile.w + x) * 4;
        px[o4] = rgba[ri * 4]!;
        px[o4 + 1] = rgba[ri * 4 + 1]!;
        px[o4 + 2] = rgba[ri * 4 + 2]!;
        px[o4 + 3] = 255;
        const al = a[ri]!;
        if (m.band[ri] && al > 5 && al < 253) {
          const nr = m.colour[ri * 3]!;
          const ng = m.colour[ri * 3 + 1]!;
          const nb = m.colour[ri * 3 + 2]!;
          if (nr !== px[o4] || ng !== px[o4 + 1] || nb !== px[o4 + 2]) changed = true;
          px[o4] = nr;
          px[o4 + 1] = ng;
          px[o4 + 2] = nb;
        }
      }
    }
    if (!changed) continue;
    const image = Skia.Image.MakeImage(
      {
        width: tile.w,
        height: tile.h,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      },
      Skia.Data.fromBytes(px),
      tile.w * 4,
    );
    if (image) patches.push({ image, x: tile.x, y: tile.y, w: tile.w, h: tile.h });
  }
  return patches;
}
