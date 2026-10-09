/**
 * All heavy pixel work (resampling, mask upscaling, alpha compositing, PNG encoding) runs inside Skia,
 * never in per-pixel JavaScript loops. Functions take/return SkImage so they chain without copies.
 */
import {
  AlphaType,
  BlendMode,
  ColorType,
  FilterMode,
  ImageFormat,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';

export async function loadImage(uri: string): Promise<SkImage> {
  const data = await Skia.Data.fromURI(uri);
  const img = Skia.Image.MakeImageFromEncoded(data);
  if (!img) throw new Error(`Could not load image: unsupported or unreadable data (${uri})`);
  return img;
}

export function imageFromBytes(bytes: Uint8Array): SkImage {
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!img) throw new Error('Could not load image: unsupported or unreadable data');
  return img;
}

function drawScaled(src: SkImage, w: number, h: number, blend?: BlendMode): SkImage {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('Out of memory: could not allocate drawing surface');
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  if (blend !== undefined) paint.setBlendMode(blend);
  canvas.drawImageRectOptions(
    src,
    Skia.XYWHRect(0, 0, src.width(), src.height()),
    Skia.XYWHRect(0, 0, w, h),
    FilterMode.Linear,
    MipmapMode.None,
    paint,
  );
  surface.flush?.();
  return surface.makeImageSnapshot();
}

/** Resize with repeated <=2x steps so large downscales do not alias. */
export function resizeImage(src: SkImage, w: number, h: number): SkImage {
  let cur = src;
  let cw = src.width();
  let ch = src.height();
  while (cw > w * 2 || ch > h * 2) {
    cw = Math.max(w, Math.ceil(cw / 2));
    ch = Math.max(h, Math.ceil(ch / 2));
    cur = drawScaled(cur, cw, ch);
  }
  return cw === w && ch === h ? cur : drawScaled(cur, w, h);
}

/** RGBA (unpremultiplied) bytes of the image resampled to w x h, e.g. the model input. */
export function sampleRgba(src: SkImage, w: number, h: number): Uint8Array {
  const small = resizeImage(src, w, h);
  const px = small.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!px) throw new Error('Could not read pixels from the image');
  return px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
}

/** Wraps an 8-bit coverage mask as an Alpha_8 image (drawn with a colour paint it tints that colour). */
export function alpha8Image(alpha: Uint8Array, w: number, h: number): SkImage {
  const img = Skia.Image.MakeImage(
    { width: w, height: h, colorType: ColorType.Alpha_8, alphaType: AlphaType.Premul },
    Skia.Data.fromBytes(alpha),
    w,
  );
  if (!img) throw new Error('Could not create a mask image');
  return img;
}

/**
 * Upscales a small coverage mask to w x h (bilinear, soft edges) and returns it as a white RGBA layer whose
 * alpha channel is the mask. This "mask layer" is what refine edits and what gets composited at export.
 */
export function maskLayerFromAlpha(
  alpha: Uint8Array,
  mw: number,
  mh: number,
  w: number,
  h: number,
): SkImage {
  const small = alpha8Image(alpha, mw, mh);
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('Out of memory: could not allocate mask surface');
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('white'));
  // Upscale in <=2x hops so the soft edges stay smooth for big ratios (320 -> 2048).
  let cur: SkImage = small;
  let cw = mw;
  let ch = mh;
  while (cw * 2 < w || ch * 2 < h) {
    cw = Math.min(w, cw * 2);
    ch = Math.min(h, ch * 2);
    const hop = Skia.Surface.Make(cw, ch);
    if (!hop) throw new Error('Out of memory: could not allocate mask surface');
    hop
      .getCanvas()
      .drawImageRectOptions(
        cur,
        Skia.XYWHRect(0, 0, cur.width(), cur.height()),
        Skia.XYWHRect(0, 0, cw, ch),
        FilterMode.Linear,
        MipmapMode.None,
        paint,
      );
    cur = hop.makeImageSnapshot();
  }
  canvas.drawImageRectOptions(
    cur,
    Skia.XYWHRect(0, 0, cur.width(), cur.height()),
    Skia.XYWHRect(0, 0, w, h),
    FilterMode.Linear,
    MipmapMode.None,
    paint,
  );
  surface.flush?.();
  return surface.makeImageSnapshot();
}

/** Applies a mask layer (its alpha channel) to an image: out = image with alpha multiplied by the mask. */
export function applyMaskLayer(
  original: SkImage,
  maskLayer: SkImage,
  w: number,
  h: number,
): SkImage {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('Out of memory: could not allocate output surface');
  const canvas = surface.getCanvas();
  const base = Skia.Paint();
  canvas.drawImageRectOptions(
    original,
    Skia.XYWHRect(0, 0, original.width(), original.height()),
    Skia.XYWHRect(0, 0, w, h),
    FilterMode.Linear,
    MipmapMode.None,
    base,
  );
  const dstIn = Skia.Paint();
  dstIn.setBlendMode(BlendMode.DstIn);
  canvas.drawImageRectOptions(
    maskLayer,
    Skia.XYWHRect(0, 0, maskLayer.width(), maskLayer.height()),
    Skia.XYWHRect(0, 0, w, h),
    FilterMode.Linear,
    MipmapMode.None,
    dstIn,
  );
  surface.flush?.();
  return surface.makeImageSnapshot();
}

/** Alpha channel of an image as bytes (w*h), for bounds detection and tests. */
export function readAlpha(img: SkImage): Uint8Array {
  const w = img.width();
  const h = img.height();
  const px = img.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!px) throw new Error('Could not read pixels from the image');
  const bytes = px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 4 + 3]!;
  return out;
}

export function encodePng(img: SkImage): Uint8Array {
  const bytes = img.encodeToBytes(ImageFormat.PNG, 100);
  if (!bytes || bytes.length === 0) throw new Error('Could not encode PNG (out of memory?)');
  return bytes;
}
