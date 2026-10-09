/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { DEFAULT_EXPORT_OPTIONS } from '@/export/options';
import { pngHasAlphaChannel } from '@/export/png';
import { ellipseMask } from '@/engine/mockEngine';
import { imageFromBytes, maskLayerFromAlpha, readAlpha } from '@/engine/skiaOps';
import {
  bakeMask,
  objectBoundsOf,
  renderExport,
  renderThumbnail,
  type SceneInputs,
} from '@/scene/exportRender';
import type { Stroke } from '@/scene/strokes';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const W = 200;
const H = 100;

function scene(strokes: Stroke[] = []): SceneInputs {
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([30, 160, 220, 255], i * 4);
  const original = Skia.Image.MakeImage(
    { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(px),
    W * 4,
  )!;
  const m = ellipseMask(50, 25);
  return {
    original,
    maskLayer: maskLayerFromAlpha(m.alpha, m.width, m.height, W, H),
    strokes,
    width: W,
    height: H,
  };
}

const opts = (o: Partial<typeof DEFAULT_EXPORT_OPTIONS> = {}) => ({
  ...DEFAULT_EXPORT_OPTIONS,
  autoCrop: false,
  ...o,
});

describe('export rendering (real Skia scene)', () => {
  it('transparent export: PNG has an alpha channel, transparent corners, opaque centre', async () => {
    const r = await renderExport(scene(), opts());
    expect([r.width, r.height]).toEqual([W, H]);
    expect(r.expectsAlpha).toBe(true);
    expect(pngHasAlphaChannel(r.png)).toBe(true);
    const a = readAlpha(imageFromBytes(r.png));
    expect(a[0]).toBe(0);
    expect(a[a.length - 1]).toBe(0);
    expect(a[50 * W + 100]).toBe(255);
  });

  it('white background export is fully opaque', async () => {
    const r = await renderExport(scene(), opts({ background: 'white' }));
    expect(r.expectsAlpha).toBe(false);
    const a = readAlpha(imageFromBytes(r.png));
    expect(Math.min(...a)).toBe(255);
    const px = imageFromBytes(r.png).readPixels(0, 0, {
      width: 1,
      height: 1,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    })!;
    expect(Array.from(px as Uint8Array)).toEqual([255, 255, 255, 255]);
  });

  it('solid colour background', async () => {
    const r = await renderExport(scene(), opts({ background: 'color', color: '#FF0000' }));
    const px = imageFromBytes(r.png).readPixels(0, 0, {
      width: 1,
      height: 1,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    })!;
    expect(Array.from(px as Uint8Array)).toEqual([255, 0, 0, 255]);
  });

  it('shadow export keeps transparency and adds soft alpha around the object', async () => {
    const r = await renderExport(scene(), opts({ background: 'shadow' }));
    expect(pngHasAlphaChannel(r.png)).toBe(true);
    const a = readAlpha(imageFromBytes(r.png));
    expect(a[0]).toBe(0);
    // somewhere outside the ellipse but inside the frame there is partial shadow alpha
    expect(a.some((v) => v > 0 && v < 200)).toBe(true);
  });

  it('auto-crop shrinks the output to the object plus padding and respects the size cap', async () => {
    const full = await renderExport(scene(), opts());
    const cropped = await renderExport(scene(), opts({ autoCrop: true, paddingPercent: 0 }));
    expect(cropped.width).toBeLessThan(full.width);
    expect(cropped.height).toBeLessThan(full.height);
    const capped = await renderExport(scene(), opts({ size: 1024 }));
    expect(capped.width).toBeLessThanOrEqual(1024);
    const small = await renderExport(scene(), opts({ autoCrop: false, size: 2048 }));
    expect(small.width).toBe(W); // never upscaled
  });

  it('auto-crop positions the object correctly (object touches the crop edges, centre opaque)', async () => {
    const r = await renderExport(scene(), opts({ autoCrop: true, paddingPercent: 0 }));
    const a = readAlpha(imageFromBytes(r.png));
    const w = r.width;
    const h = r.height;
    expect(a[Math.floor(h / 2) * w + Math.floor(w / 2)]).toBe(255);
    // ellipse extremes land on the crop box edges: left-middle and top-middle pixels are (nearly) opaque
    const row = Array.from(a.slice(Math.floor(h / 2) * w, Math.floor(h / 2) * w + w));
    expect(row[row.length - 1]).toBeLessThan(40); // soft edge at the right crop boundary...
    expect(row[0]).toBeLessThan(40); // ...and at the left one (object is centred in the crop)
    expect(Math.abs(row[3]! - row[row.length - 4]!)).toBeLessThan(12); // symmetric => no offset error
    expect(row[16]).toBe(255); // fully opaque a few px inside the box
    const col = Array.from({ length: h }, (_, y) => a[y * w + Math.floor(w / 2)]!);
    expect(col[0]).toBeLessThan(120);
    expect(col[Math.floor(h / 2)]).toBe(255);
    // and the corners of the crop are outside the ellipse
    expect(a[0]).toBeLessThan(40);
  });

  it('scales down correctly: a 50% export is the same picture at half size', async () => {
    const full = await renderExport(scene(), opts());
    const half = await renderExport(scene(), opts({ size: 1024 as never }));
    expect(half.width).toBe(full.width); // 1024 cap > 200px => no scaling
    const tiny = await renderExport(scene(), { ...opts(), size: 100 as never });
    expect(tiny.width).toBe(100);
    const a = readAlpha(imageFromBytes(tiny.png));
    expect(a[Math.floor(tiny.height / 2) * tiny.width + Math.floor(tiny.width / 2)]).toBe(255);
    expect(a[0]).toBe(0);
  });

  it('brush strokes: erase removes the object, restore brings back background', async () => {
    const erase: Stroke = {
      id: 1,
      mode: 'erase',
      size: 60,
      softness: 0,
      points: [
        { x: 100, y: 50 },
        { x: 101, y: 50 },
      ],
    };
    const restore: Stroke = {
      id: 2,
      mode: 'restore',
      size: 30,
      softness: 0,
      points: [
        { x: 20, y: 20 },
        { x: 21, y: 20 },
      ],
    };
    const r = await renderExport(scene([erase, restore]), opts());
    const a = readAlpha(imageFromBytes(r.png));
    expect(a[50 * W + 100]).toBe(0); // centre erased
    expect(a[20 * W + 20]).toBe(255); // corner restored
    expect(a[95 * W + 195]).toBe(0); // untouched corner still transparent
  });

  it('soft brush edge produces partial alpha', async () => {
    const soft: Stroke = {
      id: 1,
      mode: 'erase',
      size: 60,
      softness: 1,
      points: [
        { x: 100, y: 50 },
        { x: 101, y: 50 },
      ],
    };
    const a = readAlpha(imageFromBytes((await renderExport(scene([soft]), opts())).png));
    expect(a.some((v) => v > 10 && v < 245)).toBe(true);
  });

  it('bakeMask applies strokes into a new layer and returns the same layer when there are none', async () => {
    const s = scene();
    expect(await bakeMask(s)).toBe(s.maskLayer);
    const erase: Stroke = {
      id: 1,
      mode: 'erase',
      size: 80,
      softness: 0,
      points: [
        { x: 100, y: 50 },
        { x: 100, y: 50 },
      ],
    };
    const baked = await bakeMask({ ...s, strokes: [erase] });
    expect([baked.width(), baked.height()]).toEqual([W, H]);
    expect(readAlpha(baked)[50 * W + 100]).toBe(0);
  });

  it('finds the object bounds from the mask (with strokes applied)', async () => {
    const b = (await objectBoundsOf(scene()))!;
    expect(b.left).toBeGreaterThan(20);
    expect(b.right).toBeLessThan(180);
    expect(b.left).toBeLessThan(100);
    expect(b.right).toBeGreaterThan(100);
    const wipe: Stroke = {
      id: 1,
      mode: 'erase',
      size: 400,
      softness: 0,
      points: [
        { x: 100, y: 50 },
        { x: 100, y: 50 },
      ],
    };
    expect(await objectBoundsOf(scene([wipe]))).toBeNull();
  });

  it('renders a transparent thumbnail', async () => {
    const png = await renderThumbnail(scene(), 64);
    expect(pngHasAlphaChannel(png)).toBe(true);
    expect(imageFromBytes(png).width()).toBe(64);
  });
});
