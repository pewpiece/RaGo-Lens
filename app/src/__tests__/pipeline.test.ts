/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { MockEngine } from '@/engine/mockEngine';
import { runCutout, type PipelineDeps } from '@/engine/pipeline';
import { applyMaskLayer, imageFromBytes, readAlpha } from '@/engine/skiaOps';
import { CutoutError } from '@/engine/types';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const solid = (w: number, h: number) => {
  const px = new Uint8Array(w * h * 4).fill(200);
  for (let i = 3; i < px.length; i += 4) px[i] = 255; // opaque
  return Skia.Image.MakeImage(
    { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(px),
    w * 4,
  )!;
};

function deps(over: Partial<PipelineDeps> = {}) {
  const persisted: Uint8Array[] = [];
  const d: PipelineDeps = {
    // the photo is 400x300; the model's working copy is capped, the original stays full size
    prepare: async (uri, cap) => {
      const s = Math.min(1, cap / 400);
      return {
        original: { uri: `${uri}#orig`, width: 400, height: 300 },
        working: { uri: `${uri}#work`, width: Math.round(400 * s), height: Math.round(300 * s) },
      };
    },
    loadImage: async (uri) => {
      const s = uri.includes('#work') ? 1 : 1;
      return solid(Math.round(400 * s), Math.round(300 * s));
    },
    persistMask: (png) => {
      persisted.push(png);
      return 'file:///cache/mask.png';
    },
    ...over,
  };
  return { d, persisted };
}

describe('runCutout (real Skia + MockEngine)', () => {
  it('produces a full-resolution mask layer and a cutout with transparent corners and opaque centre', async () => {
    const { d, persisted } = deps();
    const stages: string[] = [];
    const r = await runCutout(
      {
        uri: 'file:///p.jpg',
        cap: 400,
        engine: new MockEngine({ maskSize: 64 }),
        onProgress: (_, l) => stages.push(l),
      },
      d,
    );
    expect([r.width, r.height]).toEqual([400, 300]);
    expect([r.maskLayer.width(), r.maskLayer.height()]).toEqual([400, 300]);
    expect(r.foundObject).toBe(true);
    expect(r.maskUri).toBe('file:///cache/mask.png');
    expect(persisted).toHaveLength(1);
    const out = applyMaskLayer(r.original, r.maskLayer, r.width, r.height);
    const a = readAlpha(out);
    expect(a[0]).toBe(0);
    expect(a[r.width * r.height - 1]).toBe(0);
    expect(a[150 * r.width + 200]).toBe(255);
    // persisted mask PNG decodes to the same alpha
    expect(Array.from(readAlpha(imageFromBytes(persisted[0]!))).slice(0, 50)).toEqual(
      Array.from(readAlpha(r.maskLayer)).slice(0, 50),
    );
    expect(stages[0]).toBe('Reading photo');
  });

  it('the working cap only limits what the model sees; the result stays at photo size', async () => {
    const seen: number[] = [];
    const engine = new MockEngine({ maskSize: 32 });
    const spy = {
      ...engine,
      id: 'spy',
      label: 'spy',
      segment: (i: Parameters<MockEngine['segment']>[0]) => {
        seen.push(i.width);
        return engine.segment(i);
      },
    };
    const { d } = deps();
    const r = await runCutout({ uri: 'u', cap: 200, engine: spy }, d);
    expect(seen).toEqual([200]);
    expect([r.width, r.height]).toEqual([400, 300]);
  });

  it('is cancellable mid-flight', async () => {
    const { d } = deps();
    const c = new AbortController();
    const p = runCutout(
      { uri: 'u', cap: 400, engine: new MockEngine({ delayMs: 80 }), signal: c.signal },
      d,
    );
    setTimeout(() => c.abort(), 10);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('maps engine and decode failures to friendly CutoutErrors', async () => {
    const { d } = deps();
    await expect(
      runCutout(
        { uri: 'u', cap: 400, engine: new MockEngine({ failWith: new Error('OutOfMemoryError') }) },
        d,
      ),
    ).rejects.toMatchObject({ code: 'out-of-memory' });
    const { d: bad } = deps({
      loadImage: async () => {
        throw new Error('Could not load image');
      },
    });
    await expect(
      runCutout({ uri: 'u', cap: 400, engine: new MockEngine() }, bad),
    ).rejects.toMatchObject({
      code: 'unreadable-image',
    });
    const { d: missing } = deps({
      prepare: async () => {
        throw new CutoutError('model-missing', 'x');
      },
    });
    await expect(
      runCutout({ uri: 'u', cap: 400, engine: new MockEngine() }, missing),
    ).rejects.toMatchObject({
      code: 'model-missing',
    });
  });

  it('flags when nothing was found', async () => {
    const empty = {
      id: 'empty',
      label: 'e',
      segment: async () => ({ alpha: new Uint8Array(16), width: 4, height: 4 }),
    };
    const { d } = deps();
    const r = await runCutout({ uri: 'u', cap: 400, engine: empty }, d);
    expect(r.foundObject).toBe(false);
  });
});
