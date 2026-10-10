/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { DEFAULT_EXPORT_OPTIONS } from '@/export/options';
import {
  decontaminationPatches,
  DEFAULT_REFINE,
  refineMask,
  shapeAlpha,
  bandRadiusFor,
} from '@/editor/refine';
import { imageFromBytes, readAlpha } from '@/engine/skiaOps';
import { maskToImage } from '@/mask/maskImage';
import { TiledMask } from '@/mask/tiledMask';
import { renderExport } from '@/scene/exportRender';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const W = 1100;
const H = 600;

/** A red rectangle (x 300..800, y 150..450) on green, true anti-aliased edge; plus an oversized, blurry "model" mask. */
function scene() {
  const rgba = new Uint8Array(W * H * 4);
  const init = new Uint8Array(W * H);
  const truth = new Float32Array(W * H);
  const cov = (v: number, a: number, b: number) =>
    v < a ? 0 : v === a ? 0.5 : v < b ? 1 : v === b ? 0.5 : 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = cov(x, 300, 800) * cov(y, 150, 450);
      truth[y * W + x] = a;
      rgba.set(
        [
          Math.round(a * 220 + (1 - a) * 20),
          Math.round(a * 20 + (1 - a) * 200),
          Math.round(a * 20 + (1 - a) * 30),
          255,
        ],
        (y * W + x) * 4,
      );
      const d = Math.hypot(Math.max(297 - x, x - 803, 0), Math.max(147 - y, y - 453, 0));
      init[y * W + x] = Math.round(255 * Math.min(1, Math.max(0, 1 - d / 6)));
    }
  const photo: SkImage = Skia.Image.MakeImage(
    { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(rgba),
    W * 4,
  )!;
  return { rgba, init, truth, photo, mask: TiledMask.fromFlat(init, W, H) };
}

const hard = (w: number, h: number, x0: number, x1: number, y0: number, y1: number) => {
  const a = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) a.fill(255, y * w + x0, y * w + x1);
  return a;
};

describe('shape controls (shift, smooth, soften)', () => {
  it('shift grows and shrinks the edge by the requested pixels', () => {
    const base = hard(200, 100, 50, 150, 20, 80);
    const grown = shapeAlpha(base, 200, 100, { ...DEFAULT_REFINE, shift: 4 });
    expect(grown[50 * 200 + 47]).toBe(255);
    expect(grown[50 * 200 + 44]).toBe(0);
    const shrunk = shapeAlpha(base, 200, 100, { ...DEFAULT_REFINE, shift: -4 });
    expect(shrunk[50 * 200 + 53]).toBe(0);
    expect(shrunk[50 * 200 + 55]).toBe(255);
  });
  it('softness gives a feathered edge; zero leaves a hard one', () => {
    const base = hard(200, 100, 50, 150, 20, 80);
    const soft = shapeAlpha(base, 200, 100, { ...DEFAULT_REFINE, softness: 8 });
    const mid = soft[50 * 200 + 50];
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(215);
    expect(soft[50 * 200 + 100]).toBe(255);
    expect(soft[50 * 200 + 10]).toBe(0);
  });
  it('smooth rounds a jagged contour (fewer edge direction changes) without moving the edge', () => {
    const w = 200;
    const h = 100;
    const base = hard(w, h, 50, 150, 20, 80);
    for (let y = 20; y < 80; y++)
      if (y % 2 === 0) for (let x = 50; x < 54; x++) base[y * w + x] = 0; // 4 px teeth
    const jag = (a: Uint8Array) => {
      let n = 0;
      for (let y = 21; y < 79; y++) if (a[y * w + 52]! > 127 !== a[(y - 1) * w + 52]! > 127) n++;
      return n;
    };
    const smooth = shapeAlpha(base, w, h, { ...DEFAULT_REFINE, smooth: 8 });
    expect(jag(base)).toBeGreaterThan(40);
    expect(jag(smooth)).toBeLessThan(6);
    expect(smooth[50 * w + 100]).toBe(255); // interior unchanged
  });
  it('fine-detail mode never smooths (it would erase hairs and fur)', () => {
    const base = hard(100, 50, 20, 22, 5, 45); // a 2 px wide "hair"
    const out = shapeAlpha(base, 100, 50, { ...DEFAULT_REFINE, smooth: 10, fineDetail: true });
    expect(out[25 * 100 + 21]).toBe(255);
  });
});

describe('tiled refinement over a mask larger than one tile', () => {
  it('has no seam at tile borders: tile-wise result equals refining the whole mask at once', () => {
    const { photo, init, mask } = scene();
    const s = { ...DEFAULT_REFINE, softness: 4 };
    const tiled = refineMask(photo, mask, s, { matte: false }).toFlat();
    const whole = shapeAlpha(init, W, H, s);
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i]! - tiled[i]!));
    expect(worst).toBeLessThanOrEqual(2);
  });
  it('leaves untouched tiles untouched and does not modify its input', () => {
    const { photo, mask } = scene();
    const before = mask.toFlat();
    const out = refineMask(photo, mask, { ...DEFAULT_REFINE, softness: 4 });
    expect(Array.from(mask.toFlat())).toEqual(Array.from(before));
    expect(out.uniformValue(out.tileIndex(2, 0))).toBe(0);
  });
  it('matting resolves the edge against the real photo (error against the true coverage drops a lot)', () => {
    const { photo, init, truth, mask } = scene();
    const out = refineMask(photo, mask, DEFAULT_REFINE, { bandRadius: 9 }).toFlat();
    let before = 0;
    let after = 0;
    let n = 0;
    for (let i = 0; i < out.length; i++) {
      const near = init[i]! > 0 && init[i]! < 255;
      if (!near && truth[i]! === 0 && out[i] === 0) continue;
      if (!near && truth[i]! === 1 && out[i] === 255) continue;
      before += Math.abs(init[i]! / 255 - truth[i]!);
      after += Math.abs(out[i]! / 255 - truth[i]!);
      n++;
    }
    expect(n).toBeGreaterThan(500);
    console.log(
      `edge error per band pixel: before ${(before / n).toFixed(3)}, after ${(after / n).toFixed(3)}`,
    );
    expect(after / n).toBeLessThan((before / n) * 0.4);
    // crossing the tile border (x = 512) there is no jump in the refined edge
    expect(Math.abs(out[300 * W + 511]! - out[300 * W + 512]!)).toBeLessThanOrEqual(2);
  });
  it('band radius scales with the photo', () => {
    expect(bandRadiusFor(600, 400, false)).toBe(2);
    expect(bandRadiusFor(4000, 3000, false)).toBe(12);
    expect(bandRadiusFor(4000, 3000, true)).toBe(12);
    expect(bandRadiusFor(2000, 1500, true)).toBe(12);
  });
});

describe('colour decontamination in the exported PNG', () => {
  it('the green halo around a red product is measurably reduced', async () => {
    const { photo, truth } = scene();
    // the final mask is the true coverage (what a perfect matte would give)
    const final = TiledMask.fromFlat(
      Uint8Array.from(truth, (v) => Math.round(v * 255)),
      W,
      H,
    );
    const patches = decontaminationPatches(photo, final);
    expect(patches.length).toBeGreaterThan(0);
    const render = async (p?: typeof patches) => {
      const r = await renderExport(
        {
          original: photo,
          maskLayer: maskToImage(final),
          strokes: [],
          patches: p,
          width: W,
          height: H,
        },
        { ...DEFAULT_EXPORT_OPTIONS, autoCrop: false, size: 'original' },
      );
      const img = imageFromBytes(r.png);
      const px = img.readPixels(0, 0, {
        width: W,
        height: H,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Unpremul,
      })!;
      return px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
    };
    const plain = await render();
    const clean = await render(patches);
    // edge pixels: x = 300 and x = 800 columns (half covered); true foreground colour is (220, 20, 20)
    let rawG = 0;
    let cleanG = 0;
    let n = 0;
    for (let y = 200; y < 400; y++)
      for (const x of [300, 800]) {
        const i = (y * W + x) * 4;
        rawG += plain[i + 1]! - 20;
        cleanG += clean[i + 1]! - 20;
        n++;
      }
    console.log(
      `edge green excess in the exported PNG: ${(rawG / n).toFixed(1)} -> ${(cleanG / n).toFixed(1)} (255 scale)`,
    );
    expect(rawG / n).toBeGreaterThan(60);
    expect(cleanG / n).toBeLessThan((rawG / n) * 0.35);
    // alpha is untouched by decontamination
    const a0 = readAlpha(
      imageFromBytes(
        (
          await renderExport(
            { original: photo, maskLayer: maskToImage(final), strokes: [], width: W, height: H },
            { ...DEFAULT_EXPORT_OPTIONS, autoCrop: false },
          )
        ).png,
      ),
    );
    expect(
      Math.max(
        ...Array.from({ length: 400 }, (_, k) =>
          Math.abs(a0[(200 + (k % 200)) * W + 300]! - truth[(200 + (k % 200)) * W + 300]! * 255),
        ),
      ),
    ).toBeLessThanOrEqual(1);
  }, 60000);
});
