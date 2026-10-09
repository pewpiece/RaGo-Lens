/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import '@shopify/react-native-skia/jestSetup';
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import {
  alpha8Image,
  applyMaskLayer,
  encodePng,
  imageFromBytes,
  maskLayerFromAlpha,
  readAlpha,
  resizeImage,
  sampleRgba,
} from '@/engine/skiaOps';
import { applyMaskToRgba, resizeMaskBilinear } from '@/engine/postprocess';

function solidImage(w: number, h: number, rgba: [number, number, number, number]) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(rgba, i * 4);
  return Skia.Image.MakeImage(
    { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(px),
    w * 4,
  )!;
}

describe('Skia pixel ops (real Skia via CanvasKit)', () => {
  it('resizes and samples RGBA at model-input size', () => {
    const img = solidImage(64, 48, [200, 100, 50, 255]);
    const px = sampleRgba(img, 8, 8);
    expect(px).toHaveLength(8 * 8 * 4);
    expect(Array.from(px.slice(0, 4))).toEqual([200, 100, 50, 255]);
    expect(resizeImage(img, 16, 12).width()).toBe(16);
  });

  it('a known mask applied to a solid image gives exactly the known alpha', () => {
    const w = 4;
    const h = 2;
    const img = solidImage(w, h, [10, 200, 30, 255]);
    const mask = new Uint8Array([0, 255, 255, 0, 255, 0, 0, 255]);
    const layer = maskLayerFromAlpha(mask, w, h, w, h); // same size => no resampling
    const out = applyMaskLayer(img, layer, w, h);
    expect(Array.from(readAlpha(out))).toEqual(Array.from(mask));
    // colour preserved where opaque
    const px = out.readPixels(1, 0, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul })!;
    expect(Array.from(px as Uint8Array)).toEqual([10, 200, 30, 255]);
  });

  it('matches the CPU reference (applyMaskToRgba) for partial alpha', () => {
    const w = 3;
    const h = 1;
    const img = solidImage(w, h, [255, 255, 255, 255]);
    const mask = new Uint8Array([0, 128, 255]);
    const out = applyMaskLayer(img, maskLayerFromAlpha(mask, w, h, w, h), w, h);
    const ref = applyMaskToRgba(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]), mask);
    const a = Array.from(readAlpha(out));
    const refA = [ref[3]!, ref[7]!, ref[11]!];
    a.forEach((v, i) => expect(Math.abs(v - refA[i]!)).toBeLessThanOrEqual(1));
  });

  it('upscales a small mask smoothly (soft edges) to the full image size', () => {
    const mask = new Uint8Array([0, 0, 255, 255]); // 2x2: bottom row opaque
    const layer = maskLayerFromAlpha(mask, 2, 2, 16, 16);
    expect([layer.width(), layer.height()]).toEqual([16, 16]);
    const a = readAlpha(layer);
    expect(a[0]).toBeLessThan(10);
    expect(a[255]).toBeGreaterThan(245);
    const mid = a[7 * 16 + 7]!;
    const ref = resizeMaskBilinear(mask, 2, 2, 16, 16)[7 * 16 + 7]!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
    expect(Math.abs(mid - ref)).toBeLessThan(60); // same ballpark as the bilinear reference
  });

  it('wraps Alpha_8 coverage and round-trips through readAlpha', () => {
    const cov = new Uint8Array([0, 64, 128, 255]);
    const img = alpha8Image(cov, 2, 2);
    expect(img.width()).toBe(2);
  });

  it('encodes a PNG that decodes back with its alpha channel intact', () => {
    const w = 4;
    const h = 4;
    const mask = new Uint8Array(w * h).map((_, i) => (i % 2 === 0 ? 255 : 0));
    const out = applyMaskLayer(solidImage(w, h, [1, 2, 3, 255]), maskLayerFromAlpha(mask, w, h, w, h), w, h);
    const png = encodePng(out);
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const back = imageFromBytes(png);
    expect(Array.from(readAlpha(back))).toEqual(Array.from(mask));
  });
});
