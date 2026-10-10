/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import {
  IDENTITY_MATRIX,
  analyseLevels,
  applyMatrixToRgba,
  autoEnhanceMatrix,
  enhanceMatrix,
  isIdentity,
} from '@/enhance/auto';
import { applyMatrix, enhanceWorkingCopy } from '@/enhance/apply';
import { imageFromBytes, sampleRgba } from '@/engine/skiaOps';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const W = 64;
const H = 64;
const mean = (rgba: Uint8Array, c: number) => {
  let s = 0;
  for (let i = c; i < rgba.length; i += 4) s += rgba[i]!;
  return s / (rgba.length / 4);
};
/** A gradient scene: dark/underexposed (luma 20..110) with a blue cast. */
function dark() {
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = 20 + (90 * (x + y)) / (W + H);
      rgba.set(
        [Math.round(v * 0.8), Math.round(v * 0.95), Math.round(v * 1.3), 255],
        (y * W + x) * 4,
      );
    }
  return rgba;
}
const toImage = (rgba: Uint8Array) =>
  Skia.Image.MakeImage(
    { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(rgba),
    W * 4,
  )!;

describe('auto exposure and white balance', () => {
  it('strength 0 is the identity; the matrix is 4x5 with a clean alpha row', () => {
    const m = autoEnhanceMatrix(dark(), W, H, 0);
    expect(isIdentity(m)).toBe(true);
    expect(enhanceMatrix(analyseLevels(dark(), W, H), 0.6)).toHaveLength(20);
    expect(enhanceMatrix(analyseLevels(dark(), W, H), 1).slice(15)).toEqual([0, 0, 0, 1, 0]);
    expect(IDENTITY_MATRIX).toHaveLength(20);
  });
  it('brightens an underexposed photo and removes a colour cast, more with more strength', () => {
    const src = dark();
    const lumaBefore = 0.2126 * mean(src, 0) + 0.7152 * mean(src, 1) + 0.0722 * mean(src, 2);
    const half = applyMatrixToRgba(src, autoEnhanceMatrix(src, W, H, 0.5));
    const full = applyMatrixToRgba(src, autoEnhanceMatrix(src, W, H, 1));
    const luma = (r: Uint8Array) => 0.2126 * mean(r, 0) + 0.7152 * mean(r, 1) + 0.0722 * mean(r, 2);
    expect(luma(half)).toBeGreaterThan(lumaBefore + 15);
    expect(luma(full)).toBeGreaterThan(luma(half) + 3);
    // blue cast: before the blue mean was ~60 % above red; after full strength the channels are much closer
    const spread = (r: Uint8Array) => (mean(r, 2) - mean(r, 0)) / mean(r, 1);
    expect(spread(src)).toBeGreaterThan(0.5);
    expect(spread(full)).toBeLessThan(spread(src) * 0.65);
    expect(spread(half)).toBeLessThan(spread(src));
  });
  it('an already well exposed, neutral photo is left almost alone; gains stay bounded', () => {
    const ok = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const v = Math.round((255 * (i % W)) / (W - 1));
      ok.set([v, v, v, 255], i * 4);
    }
    const out = applyMatrixToRgba(ok, autoEnhanceMatrix(ok, W, H, 1));
    let worst = 0;
    for (let i = 0; i < ok.length; i += 4) worst = Math.max(worst, Math.abs(out[i]! - ok[i]!));
    expect(worst).toBeLessThanOrEqual(30);
    const s = analyseLevels(
      new Uint8Array(W * H * 4).fill(255).map((v, i) => (i % 4 === 0 ? 255 : i % 4 === 1 ? 0 : v)),
      W,
      H,
    );
    for (const g of s.gains) {
      expect(g).toBeGreaterThanOrEqual(0.8);
      expect(g).toBeLessThanOrEqual(1.25);
    }
  });
  it('the Skia colour-filter path matches the CPU reference, and the working copy comes back as an enhanced JPEG', () => {
    const src = dark();
    const m = autoEnhanceMatrix(src, W, H, 0.8);
    const viaSkia = sampleRgba(applyMatrix(toImage(src), m), W, H);
    const ref = applyMatrixToRgba(src, m);
    let worst = 0;
    for (let i = 0; i < ref.length; i += 4)
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(viaSkia[i + c]! - ref[i + c]!));
    expect(worst).toBeLessThanOrEqual(3);
    const r = enhanceWorkingCopy(toImage(src), 0.8);
    expect(r.jpeg).not.toBeNull();
    const back = sampleRgba(imageFromBytes(r.jpeg!), W, H);
    expect(mean(back, 1)).toBeGreaterThan(mean(src, 1) + 15);
    expect(enhanceWorkingCopy(toImage(src), 0).jpeg).toBeNull();
  });
});
