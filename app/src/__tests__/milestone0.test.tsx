/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 *
 * Milestone 0: reproduce the failures from a real test (black watch on a laptop) with synthetic images,
 * through the REAL export path (render -> encode -> write -> read back from "mockDisk" -> decode).
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { DEFAULT_EXPORT_OPTIONS } from '@/export/options';
import { pngColorType } from '@/export/png';
import { runCutout, type PipelineDeps } from '@/engine/pipeline';
import { imageFromBytes, maskLayerFromAlpha, readAlpha } from '@/engine/skiaOps';
import { resizeMaskBilinear } from '@/engine/postprocess';
import type { ImageEngine } from '@/engine/types';
import {
  objectBoundsOf,
  renderExport,
  renderThumbnail,
  type SceneInputs,
} from '@/scene/exportRender';
import { computeExportGeometry } from '@/scene/exportGeometry';
import { writeVerifiedPng } from '@/export/actions';
import {
  darkOnDark,
  objectWithHoles,
  objectWithThinFeature,
  type Fixture,
} from '../../test/fixtures';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

// "mockDisk": an in-memory file store behind the app's file helpers
const mockDisk = new Map<string, Uint8Array>();
jest.mock('@/lib/files', () => ({
  writeCacheFile: (name: string, bytes: Uint8Array) => {
    mockDisk.set(`file:///cache/${name}`, bytes.slice());
    return `file:///cache/${name}`;
  },
  readFileHead: (uri: string, n: number) => mockDisk.get(uri)!.slice(0, n),
  tempName: (p: string, e: string) => `${p}-t.${e}`,
}));
jest.mock('@/library/library', () => ({ assertStorage: () => {} }));
jest.mock('expo-file-system', () => ({ Paths: { availableDiskSpace: 1e12 } }));

const imageOf = (f: Fixture): SkImage =>
  Skia.Image.MakeImage(
    {
      width: f.width,
      height: f.height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    Skia.Data.fromBytes(f.rgba),
    f.width * 4,
  )!;

const sceneOf = (f: Fixture, mask: Uint8Array = f.truth): SceneInputs => ({
  original: imageOf(f),
  maskLayer: maskLayerFromAlpha(mask, f.width, f.height, f.width, f.height),
  strokes: [],
  width: f.width,
  height: f.height,
});

const opts = (o: Partial<typeof DEFAULT_EXPORT_OPTIONS> = {}) => ({
  ...DEFAULT_EXPORT_OPTIONS,
  autoCrop: false,
  size: 'original' as const,
  ...o,
});

function readRgba(img: SkImage): Uint8Array {
  const px = img.readPixels(0, 0, {
    width: img.width(),
    height: img.height(),
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  })!;
  return px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
}

describe('M0.1 transparency survives the real export path', () => {
  it('the saved file is RGBA, background alpha is 0, holes are transparent, nothing is filled with black', async () => {
    const f = objectWithHoles();
    const rendered = await renderExport(sceneOf(f), opts());
    const uri = writeVerifiedPng(rendered);

    const onDisk = mockDisk.get(uri)!;
    expect(pngColorType(onDisk)).toBe(6); // RGBA, not RGB (2)
    const decoded = imageFromBytes(onDisk);
    expect([decoded.width(), decoded.height()]).toEqual([f.width, f.height]);
    const a = readAlpha(decoded);
    const rgba = readRgba(decoded);

    // every pixel's alpha matches the mask a person would draw (this includes the 7 holes and the slot)
    let wrong = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - f.truth[i]!) > 1) wrong++;
    expect(wrong).toBe(0);
    // background corners fully transparent
    expect(a[0]).toBe(0);
    expect(a[a.length - 1]).toBe(0);
    // a hole (grey surface seen through the strap) must be transparent, not "old background"
    const holeIdx = Math.round(f.height * 0.5) * f.width + Math.round(f.width * 0.47);
    expect(f.truth[holeIdx]).toBe(0);
    expect(f.modelMask[holeIdx]).toBe(255);
    expect(a[holeIdx]).toBe(0);
    // nothing outside the object was replaced by an opaque black fill
    let opaqueBlackOutside = 0;
    for (let i = 0; i < a.length; i++)
      if (f.truth[i] === 0 && a[i]! > 0 && rgba[i * 4]! < 8 && rgba[i * 4 + 1]! < 8)
        opaqueBlackOutside++;
    expect(opaqueBlackOutside).toBe(0);
  });

  it('a dark product on a dark scene keeps a real transparent surround', async () => {
    const f = darkOnDark();
    const r = await renderExport(sceneOf(f), opts());
    const uri = writeVerifiedPng(r);
    expect(pngColorType(mockDisk.get(uri)!)).toBe(6);
    const a = readAlpha(imageFromBytes(mockDisk.get(uri)!));
    const transparent = a.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
    const expected = f.truth.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
    expect(transparent).toBe(expected);
  });

  it('refuses to save a "transparent" export whose pixels are all opaque (header alone is not proof)', async () => {
    const f = objectWithHoles();
    const solid = new Uint8Array(f.width * f.height).fill(255); // a mask that keeps everything
    const r = await renderExport(sceneOf(f, solid), opts());
    expect(() => writeVerifiedPng(r)).toThrow(/transparen/i);
  });
});

describe('M0.1b library thumbnails keep their transparency too', () => {
  it('the thumbnail is an RGBA PNG with a transparent surround and a bounded size', async () => {
    const f = objectWithHoles(1200, 600);
    const png = await renderThumbnail(sceneOf(f), 320);
    expect(pngColorType(png)).toBe(6);
    const img = imageFromBytes(png);
    expect(Math.max(img.width(), img.height())).toBe(320);
    const a = readAlpha(img);
    expect(a[0]).toBe(0);
    expect(a.some((v) => v === 255)).toBe(true);
  });
});

describe('M0.2 export size is the photo size, never the model working size', () => {
  const f = objectWithThinFeature(1200, 800);
  const photo = imageOf(f);
  const engine: ImageEngine = {
    id: 'fake',
    label: 'fake',
    segment: async (input) => ({
      alpha: resizeMaskBilinear(f.truth, f.width, f.height, input.width, input.height),
      width: input.width,
      height: input.height,
    }),
  };
  const deps = (): PipelineDeps => ({
    prepare: async (_uri, cap) => {
      const s = Math.min(1, cap / Math.max(f.width, f.height));
      return {
        original: { uri: 'file:///orig.jpg', width: f.width, height: f.height },
        working: {
          uri: 'file:///work.jpg',
          width: Math.round(f.width * s),
          height: Math.round(f.height * s),
        },
      };
    },
    loadImage: async () => photo,
    persistMask: () => 'file:///cache/mask.png',
  });

  it('a 1200x800 photo processed with a 300 px working cap exports at 1200x800', async () => {
    const r = await runCutout({ uri: 'file:///p.jpg', cap: 300, engine }, deps());
    expect([r.width, r.height]).toEqual([1200, 800]);
    expect([r.original.width(), r.original.height()]).toEqual([1200, 800]);
    expect([r.maskLayer.width(), r.maskLayer.height()]).toEqual([1200, 800]);
    const out = await renderExport(
      {
        original: r.original,
        maskLayer: r.maskLayer,
        strokes: [],
        width: r.width,
        height: r.height,
      },
      opts(),
    );
    expect([out.width, out.height]).toEqual([1200, 800]);
    expect(pngColorType(out.png)).toBe(6);
  });

  it('a 4000x3000 export is 4000x3000 (geometry and a real render)', async () => {
    const g = computeExportGeometry(4000, 3000, null, opts());
    expect([g.outWidth, g.outHeight]).toEqual([4000, 3000]);
    const px = new Uint8Array(4000 * 3000 * 4).fill(90);
    const img = Skia.Image.MakeImage(
      { width: 4000, height: 3000, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
      Skia.Data.fromBytes(px),
      4000 * 4,
    )!;
    const mask = new Uint8Array(4000 * 3000);
    for (let y = 1000; y < 2000; y++) mask.fill(255, y * 4000 + 1000, y * 4000 + 3000);
    const out = await renderExport(
      {
        original: img,
        maskLayer: maskLayerFromAlpha(mask, 4000, 3000, 4000, 3000),
        strokes: [],
        width: 4000,
        height: 3000,
      },
      opts(),
    );
    expect([out.width, out.height]).toEqual([4000, 3000]);
  }, 120000);
});

describe('M0.3 auto-crop pads the object and never cuts mask pixels', () => {
  const f = objectWithThinFeature(1600, 1000);

  it('measures the true mask: a 1 px wide feature is inside the bounds', async () => {
    const b = (await objectBoundsOf(sceneOf(f)))!;
    expect(b.right).toBeGreaterThanOrEqual(f.width - 5); // the feature runs to x = w - 6
    expect(b.left).toBeLessThanOrEqual(Math.round(f.width * 0.3));
  });

  it('every mask pixel survives auto-crop, and the crop has padding on all sides', async () => {
    const scene = sceneOf(f);
    const full = readAlpha((await renderExport(scene, opts())).image);
    const total = full.reduce((n, v) => n + v, 0);
    const cropped = await renderExport(scene, opts({ autoCrop: true, paddingPercent: 4 }));
    const sum = readAlpha(cropped.image).reduce((n, v) => n + v, 0);
    expect(sum).toBe(total);
    // padding: transparent margin of at least ~4% of the longer object side on every edge
    const a = readAlpha(cropped.image);
    const W = cropped.width;
    const H = cropped.height;
    const objectLong =
      Math.round(f.width * 0.7) -
      Math.round(f.width * 0.3) +
      (f.width - 5 - Math.round(f.width * 0.7));
    const minPad = Math.floor(objectLong * 0.04 - 1);
    const rowHas = (y: number) => a.slice(y * W, (y + 1) * W).some((v) => v > 0);
    const colHas = (x: number) => {
      for (let y = 0; y < H; y++) if (a[y * W + x]! > 0) return true;
      return false;
    };
    let top = 0;
    while (!rowHas(top)) top++;
    let bottom = 0;
    while (!rowHas(H - 1 - bottom)) bottom++;
    let left = 0;
    while (!colHas(left)) left++;
    let right = 0;
    while (!colHas(W - 1 - right)) right++;
    for (const m of [top, bottom, left, right]) expect(m).toBeGreaterThanOrEqual(minPad);
  });
});
