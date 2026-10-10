/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { renderComposite } from '@/compose/render';
import { DEFAULT_EDIT_STATE, parseEditState, serializeEditState } from '@/edit/editState';
import { MockEngine } from '@/engine/mockEngine';
import { runCutout, type PipelineDeps } from '@/engine/pipeline';
import { sourceFromParts, toProductInputs } from '@/export/productSource';
import { TiledMask } from '@/mask/tiledMask';
import { parseAutoEnhance } from '@/store/settingsStore';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const W = 120;
const H = 80;
const img = (): SkImage => {
  const px = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set([30, 38, 60, 255], i * 4); // dark, blue cast
  return Skia.Image.MakeImage(
    { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(px),
    W * 4,
  )!;
};

const deps = (calls: string[]): PipelineDeps => ({
  prepare: async () => ({
    original: { uri: 'o', width: W, height: H },
    working: { uri: 'file:///work.jpg', width: W, height: H },
  }),
  loadImage: async () => img(),
  persistMask: () => 'file:///m.png',
  enhanceWorking: async (uri, strength) => {
    calls.push(`${uri}@${strength}`);
    return {
      uri: 'file:///work-enhanced.jpg',
      matrix: [1.5, 0, 0, 0, 0, 0, 1.4, 0, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, 1, 0],
    };
  },
});

describe('auto exposure / white balance in the pipeline', () => {
  it('the model sees the enhanced working copy, and the result remembers the matrix', async () => {
    const calls: string[] = [];
    const seen: string[] = [];
    const engine = new MockEngine({ maskSize: 32 });
    const spy = {
      ...engine,
      id: 'spy',
      label: 'spy',
      segment: (i: Parameters<MockEngine['segment']>[0]) => (seen.push(i.uri), engine.segment(i)),
    };
    const r = await runCutout(
      { uri: 'file:///p.jpg', cap: 200, engine: spy, enhance: 0.7 },
      deps(calls),
    );
    expect(calls).toEqual(['file:///work.jpg@0.7']);
    expect(seen).toEqual(['file:///work-enhanced.jpg']);
    expect(r.enhance?.strength).toBe(0.7);
    expect(r.enhance?.matrix).toHaveLength(20);
  });
  it('is off by default and when the strength is 0', async () => {
    const calls: string[] = [];
    const r = await runCutout(
      { uri: 'u', cap: 200, engine: new MockEngine({ maskSize: 32 }) },
      deps(calls),
    );
    const r0 = await runCutout(
      { uri: 'u', cap: 200, engine: new MockEngine({ maskSize: 32 }), enhance: 0 },
      deps(calls),
    );
    expect(calls).toEqual([]);
    expect(r.enhance).toBeUndefined();
    expect(r0.enhance).toBeUndefined();
  });
});

describe('applying it to the export is a separate, explicit choice', () => {
  const mask = TiledMask.fromFlat(new Uint8Array(W * H).fill(255), W, H);
  const pixel = async (exportToo: boolean) => {
    const matrix = [1.5, 0, 0, 0, 0, 0, 1.4, 0, 0, 0, 0, 0, 1.2, 0, 0, 0, 0, 0, 1, 0];
    const edit = { ...DEFAULT_EDIT_STATE, enhance: { matrix, strength: 1, exportToo } };
    const src = sourceFromParts(img(), mask, edit);
    const product = await toProductInputs(src);
    const r = await renderComposite(
      product,
      {
        canvas: { ...edit.canvas, aspect: 'original', paddingPercent: 0 },
        transform: edit.transform,
        shadow: edit.shadow,
        background: edit.background,
        fill: null,
      },
      { format: 'png', quality: 100, maxBytes: null },
    );
    const px = r.image.readPixels(10, 10, {
      width: 1,
      height: 1,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    })!;
    return Array.from(px as Uint8Array);
  };
  it('off: the export keeps the photo colours; on: the same matrix is applied', async () => {
    const off = await pixel(false);
    const on = await pixel(true);
    expect(off.slice(0, 3)).toEqual([30, 38, 60]);
    expect(on.slice(0, 3)).toEqual([45, 53, 72]); // 30*1.5, 38*1.4, 60*1.2
  });
  it('edit state and settings round-trip, and junk falls back', () => {
    const e = {
      ...DEFAULT_EDIT_STATE,
      enhance: { matrix: [...Array(19).fill(0), 1], strength: 0.4, exportToo: true },
    };
    expect(parseEditState(serializeEditState(e)).enhance).toEqual(e.enhance);
    expect(parseEditState('{"enhance":{"matrix":[1,2,3]}}').enhance.matrix).toBeNull();
    expect(parseAutoEnhance('{"enabled":true,"strength":5}')).toEqual({
      enabled: true,
      strength: 1,
      exportToo: false,
    });
    expect(parseAutoEnhance('nope').enabled).toBe(false);
  });
});
