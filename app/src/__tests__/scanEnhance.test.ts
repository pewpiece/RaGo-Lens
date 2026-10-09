/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { enhanceForOcr, stretchMatrix, stretchRange } from '@/scan/enhance';
import { sampleRgba } from '@/engine/skiaOps';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

/** Pale brownish paper (170) with faint "pencil" stripes (150): contrast of only 20 levels. */
function faintPage(w = 64, h = 64) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ink = y % 8 < 2 && x > 6 && x < w - 6;
      const v = ink ? 150 : 170;
      px.set([v + 6, v, v - 8, 255], (y * w + x) * 4);
    }
  return Skia.Image.MakeImage(
    { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(px),
    w * 4,
  )!;
}

const lumRange = (img: ReturnType<typeof faintPage>) => {
  const px = sampleRgba(img, img.width(), img.height());
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  return { lo, hi };
};

describe('stretchRange', () => {
  it('uses percentiles so a few outliers do not set the range', () => {
    const lum = new Uint8Array(1000).fill(160);
    lum[0] = 0; // one black speck
    lum[1] = 255; // one glare pixel
    for (let i = 2; i < 102; i++) lum[i] = 90; // 10 % darker "ink"
    expect(stretchRange(lum)).toEqual({ lo: 90, hi: 160 });
  });
  it('keeps a minimum span for flat images', () => {
    const r = stretchRange(new Uint8Array(100).fill(128));
    expect(r.hi - r.lo).toBeGreaterThanOrEqual(12);
  });
  it('handles empty input', () => {
    expect(stretchRange([])).toEqual({ lo: 0, hi: 255 });
  });
});

describe('stretchMatrix', () => {
  it('is a 4x5 matrix that leaves alpha alone', () => {
    const m = stretchMatrix({ lo: 100, hi: 200 });
    expect(m).toHaveLength(20);
    expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
    // grey in -> stretched grey out: lo maps to 0, hi maps to 1
    const out = (g: number) => m[0]! * g + m[1]! * g + m[2]! * g + m[4]!;
    expect(out(100 / 255)).toBeCloseTo(0, 2);
    expect(out(200 / 255)).toBeCloseTo(1, 2);
  });
});

describe('enhanceForOcr (real Skia)', () => {
  it('stretches a faint, tinted page to a much wider tonal range, as grey, same size', () => {
    const src = faintPage();
    const before = lumRange(src);
    expect(before.hi - before.lo).toBeLessThan(35);
    const out = enhanceForOcr(src);
    expect([out.width(), out.height()]).toEqual([64, 64]);
    const after = lumRange(out);
    expect(after.hi - after.lo).toBeGreaterThan(200);
    // grey: R = G = B
    const px = sampleRgba(out, 64, 64);
    expect(Math.abs(px[0]! - px[1]!)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[1]! - px[2]!)).toBeLessThanOrEqual(2);
    expect(px[3]).toBe(255);
  });

  it('keeps the ink darker than the paper', () => {
    const out = enhanceForOcr(faintPage());
    const px = sampleRgba(out, 64, 64);
    const at = (x: number, y: number) => px[(y * 64 + x) * 4]!;
    expect(at(30, 0)).toBeLessThan(at(30, 4)); // stripe row (y%8<2) vs paper row
  });
});
