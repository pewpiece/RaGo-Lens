import {
  AlphaType,
  BlendMode,
  BlurStyle,
  ColorType,
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  type SkCanvas,
  type SkImage,
  type SkPath,
} from '@shopify/react-native-skia';
import { alpha8Image, readAlpha } from '@/engine/skiaOps';
import type { EditSession } from '@/mask/history';
import { TILE, TiledMask, type Rect } from '@/mask/tiledMask';
import { refineMatte } from './matting';

/**
 * Pixel edits on a TiledMask done by Skia, one tile at a time: the tile's current coverage is drawn into a small
 * surface, the edit is composited on top with a blend mode (dstOut = remove, srcOver = add, dstIn = intersect), and the
 * result is read back into the tile. No per-pixel JavaScript runs over the image in this file except for the colour
 * read-back of one 512 px tile.
 */
export type BrushMode = 'erase' | 'restore';

export interface BrushStroke {
  mode: BrushMode;
  /** Brush diameter in photo px. */
  size: number;
  /** 0 = hard edge, 1 = very soft. */
  softness: number;
  /** 0..1 */
  opacity: number;
  points: { x: number; y: number }[];
}

export const softnessSigma = (size: number, softness: number): number =>
  Math.max(0, size * 0.25 * Math.min(1, Math.max(0, softness)));

export function pathOfPoints(points: { x: number; y: number }[], close = false): SkPath {
  const b = Skia.PathBuilder.Make();
  if (points.length > 0) {
    b.moveTo(points[0]!.x, points[0]!.y);
    if (points.length === 1) b.lineTo(points[0]!.x + 0.01, points[0]!.y);
    for (let i = 1; i < points.length; i++) b.lineTo(points[i]!.x, points[i]!.y);
    if (close) b.close();
  }
  return b.build();
}

export function pointsBounds(points: { x: number; y: number }[], pad = 0): Rect {
  let l = Infinity,
    t = Infinity,
    r = -Infinity,
    b = -Infinity;
  for (const p of points) {
    if (p.x < l) l = p.x;
    if (p.y < t) t = p.y;
    if (p.x > r) r = p.x;
    if (p.y > b) b = p.y;
  }
  if (!Number.isFinite(l)) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.floor(l - pad);
  const y = Math.floor(t - pad);
  return { x, y, w: Math.ceil(r + pad) - x, h: Math.ceil(b + pad) - y };
}

type Draw = (canvas: SkCanvas, rect: Rect) => void;

/** Re-renders the given tiles: existing coverage first, then `draw` (in photo coordinates). */
export function rebuildTiles(
  mask: TiledMask,
  tiles: number[],
  session: EditSession | null,
  draw: Draw,
): number[] {
  const changed: number[] = [];
  const white = Skia.Paint();
  white.setColor(Skia.Color('white'));
  for (const index of tiles) {
    const r = mask.tileRect(index);
    session?.touch(index);
    const surface = Skia.Surface.Make(r.w, r.h);
    if (!surface) throw new Error('Out of memory: could not allocate an editing surface');
    const canvas = surface.getCanvas();
    const u = mask.uniformValue(index);
    if (u === null) canvas.drawImage(alpha8Image(mask.getTile(index), r.w, r.h), 0, 0, white);
    else if (u > 0) {
      const p = Skia.Paint();
      p.setColor(Skia.Color('white'));
      p.setAlphaf(u / 255);
      canvas.drawRect(Skia.XYWHRect(0, 0, r.w, r.h), p);
    }
    canvas.save();
    canvas.translate(-r.x, -r.y);
    draw(canvas, r);
    canvas.restore();
    surface.flush?.();
    const a = readAlpha(surface.makeImageSnapshot());
    mask.setTile(index, a);
    changed.push(index);
  }
  return changed;
}

/** Tile indices touched by a rect, clamped to the mask. */
export const tilesFor = (mask: TiledMask, rect: Rect): number[] => mask.tilesIn(rect);

function strokePaint(s: BrushStroke): ReturnType<typeof Skia.Paint> {
  const p = Skia.Paint();
  p.setColor(Skia.Color('white'));
  p.setAlphaf(Math.min(1, Math.max(0, s.opacity)));
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(Math.max(1, s.size));
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  p.setAntiAlias(true);
  const sigma = softnessSigma(s.size, s.softness);
  if (sigma > 0.01) p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true));
  return p;
}

/**
 * Draws a brush stroke's effect. When `matte` is given (smart brush) the stroke only acts where the matte is opaque.
 * The stroke is composited as a layer so a stroke crossing itself applies once, not twice.
 */
export function drawStrokeEffect(
  canvas: SkCanvas,
  s: BrushStroke,
  matte?: { image: SkImage; dest: Rect },
): void {
  const layer = Skia.Paint();
  layer.setBlendMode(s.mode === 'erase' ? BlendMode.DstOut : BlendMode.SrcOver);
  canvas.saveLayer(layer);
  canvas.drawPath(pathOfPoints(s.points), strokePaint(s));
  if (matte) {
    const m = Skia.Paint();
    m.setBlendMode(BlendMode.DstIn);
    canvas.drawImageRectOptions(
      matte.image,
      Skia.XYWHRect(0, 0, matte.image.width(), matte.image.height()),
      Skia.XYWHRect(matte.dest.x, matte.dest.y, matte.dest.w, matte.dest.h),
      FilterMode.Linear,
      MipmapMode.None,
      m,
    );
  }
  canvas.restore();
}

export function applyStroke(
  mask: TiledMask,
  s: BrushStroke,
  session: EditSession | null,
  matte?: { image: SkImage; dest: Rect },
): number[] {
  const pad = s.size / 2 + softnessSigma(s.size, s.softness) * 3 + 2;
  const tiles = tilesFor(mask, pointsBounds(s.points, pad));
  return rebuildTiles(mask, tiles, session, (canvas) => drawStrokeEffect(canvas, s, matte));
}

// ---------------------------------------------------------------- selections

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';

export type SelectionShape =
  | { kind: 'path'; points: { x: number; y: number }[] }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number };

export function shapePath(s: SelectionShape): SkPath {
  if (s.kind === 'path') return pathOfPoints(s.points, true);
  const b = Skia.PathBuilder.Make();
  if (s.kind === 'rect') b.addRect(Skia.XYWHRect(s.x, s.y, s.w, s.h));
  else b.addOval(Skia.XYWHRect(s.x, s.y, s.w, s.h));
  return b.build();
}

function shapeBounds(s: SelectionShape): Rect {
  if (s.kind === 'path') return pointsBounds(s.points, 2);
  return {
    x: Math.floor(s.x) - 2,
    y: Math.floor(s.y) - 2,
    w: Math.ceil(s.w) + 4,
    h: Math.ceil(s.h) + 4,
  };
}

/** Combines a vector shape into a selection mask with add / subtract / intersect / replace. */
export function applyShapeToSelection(
  sel: TiledMask,
  shape: SelectionShape,
  mode: SelectMode,
): number[] {
  const path = shapePath(shape);
  const hit = new Set(sel.tilesIn(shapeBounds(shape)));
  // replace and intersect clear everything outside the shape too
  const tiles =
    mode === 'replace' || mode === 'intersect'
      ? Array.from({ length: sel.tileCount }, (_, i) => i)
      : [...hit];
  return rebuildTiles(sel, tiles, null, (canvas, rect) => {
    const p = Skia.Paint();
    p.setColor(Skia.Color('white'));
    p.setAntiAlias(true);
    if (mode === 'replace') {
      // wipe, then draw the shape
      canvas.clear(Skia.Color('transparent'));
      if (hit.has(sel.tileIndex(Math.floor(rect.x / TILE), Math.floor(rect.y / TILE))))
        canvas.drawPath(path, p);
    } else if (mode === 'add') {
      canvas.drawPath(path, p);
    } else if (mode === 'subtract') {
      p.setBlendMode(BlendMode.DstOut);
      canvas.drawPath(path, p);
    } else {
      // intersect: keep only what is inside the shape
      const keep = Skia.Paint();
      keep.setBlendMode(BlendMode.DstIn);
      canvas.saveLayer(keep);
      canvas.drawPath(path, p);
      canvas.restore();
    }
  });
}

/** Merges a whole selection-sized mask (e.g. from the wand) into the selection with the chosen mode. */
export function mergeSelection(sel: TiledMask, other: TiledMask, mode: SelectMode): number[] {
  const tiles =
    mode === 'replace' || mode === 'intersect'
      ? Array.from({ length: sel.tileCount }, (_, i) => i)
      : Array.from({ length: sel.tileCount }, (_, i) => i).filter(
          (i) => other.uniformValue(i) !== 0,
        );
  return rebuildTiles(sel, tiles, null, (canvas, rect) => {
    const o = other.uniformValue(
      sel.tileIndex(Math.floor(rect.x / TILE), Math.floor(rect.y / TILE)),
    );
    const img =
      o === null
        ? alpha8Image(
            other.getTile(sel.tileIndex(Math.floor(rect.x / TILE), Math.floor(rect.y / TILE))),
            rect.w,
            rect.h,
          )
        : null;
    const paint = Skia.Paint();
    paint.setColor(Skia.Color('white'));
    const drawOther = (p: ReturnType<typeof Skia.Paint>) => {
      if (img) canvas.drawImage(img, rect.x, rect.y, p);
      else if (o && o > 0) {
        p.setAlphaf(o / 255);
        canvas.drawRect(Skia.XYWHRect(rect.x, rect.y, rect.w, rect.h), p);
      }
    };
    if (mode === 'replace') {
      canvas.clear(Skia.Color('transparent'));
      drawOther(paint);
    } else if (mode === 'add') drawOther(paint);
    else if (mode === 'subtract') {
      paint.setBlendMode(BlendMode.DstOut);
      drawOther(paint);
    } else {
      paint.setBlendMode(BlendMode.DstIn);
      if (o === 0) canvas.clear(Skia.Color('transparent'));
      else drawOther(paint);
    }
  });
}

export function invertSelection(sel: TiledMask): void {
  rebuildTiles(
    sel,
    Array.from({ length: sel.tileCount }, (_, i) => i),
    null,
    (canvas, rect) => {
      // an opaque rect drawn with Xor leaves alpha = 1 - existing coverage
      const p = Skia.Paint();
      p.setColor(Skia.Color('white'));
      p.setBlendMode(BlendMode.Xor);
      canvas.drawRect(Skia.XYWHRect(rect.x, rect.y, rect.w, rect.h), p);
    },
  );
}

/** Tile indices whose selection is non-empty. */
export const nonEmptyTiles = (sel: TiledMask): number[] =>
  Array.from({ length: sel.tileCount }, (_, i) => i).filter((i) => sel.uniformValue(i) !== 0);

export function selectionIsEmpty(sel: TiledMask): boolean {
  return nonEmptyTiles(sel).length === 0;
}

/** Removes (erase) or restores (keep) the selected pixels in the cut-out mask. */
export function applySelectionToMask(
  mask: TiledMask,
  sel: TiledMask,
  action: 'remove' | 'keep',
  session: EditSession | null,
): number[] {
  if (mask.width !== sel.width || mask.height !== sel.height)
    throw new Error('selection and mask sizes differ');
  const tiles = nonEmptyTiles(sel);
  return rebuildTiles(mask, tiles, session, (canvas, rect) => {
    const index = mask.tileIndex(Math.floor(rect.x / TILE), Math.floor(rect.y / TILE));
    const u = sel.uniformValue(index);
    const p = Skia.Paint();
    p.setColor(Skia.Color('white'));
    p.setBlendMode(action === 'remove' ? BlendMode.DstOut : BlendMode.SrcOver);
    if (u === null)
      canvas.drawImage(alpha8Image(sel.getTile(index), rect.w, rect.h), rect.x, rect.y, p);
    else {
      p.setAlphaf(u / 255);
      canvas.drawRect(Skia.XYWHRect(rect.x, rect.y, rect.w, rect.h), p);
    }
  });
}

// ------------------------------------------------- selection from a small analysis mask

/** Pixel reader for the full-resolution photo (a Skia image). */
export function readRgbaRegion(img: SkImage, r: Rect): Uint8Array {
  const px = img.readPixels(r.x, r.y, {
    width: r.w,
    height: r.h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!px) throw new Error('Could not read the photo');
  return px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
}

/**
 * Turns a 0/255 selection computed on a small copy (sw x sh) into a full-resolution selection (W x H):
 * bilinear upscale, then the uncertain edge band is snapped to the real edges of the full-resolution photo with the
 * matting step (so the selection does not carry the blur of the small copy).
 */
export function upsampleSelection(
  small: Uint8Array,
  sw: number,
  sh: number,
  photo: SkImage,
  snap = true,
): TiledMask {
  const W = photo.width();
  const H = photo.height();
  const out = new TiledMask(W, H, 0);
  // bounding box of the small selection (so empty regions cost nothing)
  let l = sw,
    t = sh,
    r = -1,
    b = -1;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      if (small[y * sw + x]) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
  if (r < 0) return out;
  const kx = W / sw;
  const ky = H / sh;
  const bandR = Math.max(2, Math.ceil(Math.max(kx, ky)) + 1);
  const margin = snap ? bandR * 3 : 0;
  const box: Rect = {
    x: Math.floor(l * kx) - 2,
    y: Math.floor(t * ky) - 2,
    w: Math.ceil((r + 1) * kx) - Math.floor(l * kx) + 4,
    h: Math.ceil((b + 1) * ky) - Math.floor(t * ky) + 4,
  };
  const smallImg = alpha8Image(small, sw, sh);
  const white = Skia.Paint();
  white.setColor(Skia.Color('white'));
  for (const index of out.tilesIn(box)) {
    const tr = out.tileRect(index);
    const reg: Rect = {
      x: Math.max(0, tr.x - margin),
      y: Math.max(0, tr.y - margin),
      w: 0,
      h: 0,
    };
    reg.w = Math.min(W, tr.x + tr.w + margin) - reg.x;
    reg.h = Math.min(H, tr.y + tr.h + margin) - reg.y;
    const surface = Skia.Surface.Make(reg.w, reg.h);
    if (!surface) throw new Error('Out of memory: could not allocate a selection surface');
    surface
      .getCanvas()
      .drawImageRectOptions(
        smallImg,
        Skia.XYWHRect(reg.x / kx, reg.y / ky, reg.w / kx, reg.h / ky),
        Skia.XYWHRect(0, 0, reg.w, reg.h),
        FilterMode.Linear,
        MipmapMode.None,
        white,
      );
    surface.flush?.();
    let alpha = readAlpha(surface.makeImageSnapshot());
    if (snap) {
      const rgba = readRgbaRegion(photo, reg);
      alpha = refineMatte(rgba, alpha, reg.w, reg.h, { bandRadius: bandR }).alpha;
    }
    const tile = new Uint8Array(tr.w * tr.h);
    for (let y = 0; y < tr.h; y++) {
      const s = (tr.y - reg.y + y) * reg.w + (tr.x - reg.x);
      tile.set(alpha.subarray(s, s + tr.w), y * tr.w);
    }
    out.setTile(index, tile);
  }
  return out;
}

// ---------------------------------------------------------- feather / grow / shrink

export type SelectionAdjust =
  | { kind: 'feather'; radius: number }
  | { kind: 'grow'; radius: number }
  | { kind: 'shrink'; radius: number };

/** Bounding box of the non-empty part of a selection, or null. Coarse (tile resolution) then exact per tile. */
export function selectionBounds(sel: TiledMask): Rect | null {
  const tiles = nonEmptyTiles(sel);
  if (tiles.length === 0) return null;
  let l = Infinity,
    t = Infinity,
    r = -Infinity,
    b = -Infinity;
  for (const i of tiles) {
    const tr = sel.tileRect(i);
    const a = sel.getTile(i);
    for (let y = 0; y < tr.h; y++)
      for (let x = 0; x < tr.w; x++)
        if (a[y * tr.w + x]) {
          if (tr.x + x < l) l = tr.x + x;
          if (tr.x + x > r) r = tr.x + x;
          if (tr.y + y < t) t = tr.y + y;
          if (tr.y + y > b) b = tr.y + y;
        }
  }
  return Number.isFinite(l) ? { x: l, y: t, w: r - l + 1, h: b - t + 1 } : null;
}

/** Feather (blur) or grow/shrink (dilate/erode) a selection with Skia image filters, working on its bounding box only. */
export function adjustSelection(sel: TiledMask, adj: SelectionAdjust): void {
  const bb = selectionBounds(sel);
  if (!bb || adj.radius <= 0) return;
  const pad = Math.ceil(adj.radius * 3) + 2;
  const reg: Rect = {
    x: Math.max(0, bb.x - pad),
    y: Math.max(0, bb.y - pad),
    w: 0,
    h: 0,
  };
  reg.w = Math.min(sel.width, bb.x + bb.w + pad) - reg.x;
  reg.h = Math.min(sel.height, bb.y + bb.h + pad) - reg.y;
  const src = sel.readRegion(reg);
  const img = alpha8Image(src, reg.w, reg.h);
  const surface = Skia.Surface.Make(reg.w, reg.h);
  if (!surface) throw new Error('Out of memory: could not allocate a selection surface');
  const p = Skia.Paint();
  p.setColor(Skia.Color('white'));
  const r = adj.radius;
  p.setImageFilter(
    adj.kind === 'feather'
      ? Skia.ImageFilter.MakeBlur(r / 2, r / 2, TileMode.Decal, null)
      : adj.kind === 'grow'
        ? Skia.ImageFilter.MakeDilate(r, r, null)
        : Skia.ImageFilter.MakeErode(r, r, null),
  );
  surface.getCanvas().drawImage(img, 0, 0, p);
  surface.flush?.();
  const out = readAlpha(surface.makeImageSnapshot());
  sel.writeRegion(reg, out);
}
