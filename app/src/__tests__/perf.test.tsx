/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 *
 * Performance profile of the heavy paths on a large photo (default 12 MP; set PERF_W / PERF_H for 24 MP, e.g.
 * PERF_W=6000 PERF_H=4000). Timings are Node + CanvasKit (CPU raster, WASM) on whatever machine runs the tests: they show
 * which steps dominate and catch pathological regressions. They are NOT phone numbers and no phone speed is claimed.
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { renderComposite } from '@/compose/render';
import { DEFAULT_EDIT_STATE } from '@/edit/editState';
import { makeAnalysis } from '@/editor/analysis';
import { EditorDoc } from '@/editor/doc';
import { decontaminationPatches, DEFAULT_REFINE, refineMask } from '@/editor/refine';
import { suggestCleanups } from '@/editor/suggest';
import { sourceFromParts, toProductInputs } from '@/export/productSource';
import { maskTightBounds } from '@/mask/bounds';
import { TiledMask } from '@/mask/tiledMask';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const W = Number(process.env.PERF_W ?? 4000);
const H = Number(process.env.PERF_H ?? 3000);
const rows: string[] = [];
const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

async function step<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  const ms = performance.now() - t0;
  rows.push(
    `${label.padEnd(46)} ${ms.toFixed(0).padStart(7)} ms   rss ${mb(process.memoryUsage().rss)}`,
  );
  expect(Number.isFinite(ms)).toBe(true);
  return out;
}

describe(`profile on ${W}x${H} (${((W * H) / 1e6).toFixed(0)} MP)`, () => {
  afterAll(() => {
    console.log(
      `\nPERFORMANCE PROFILE ${W}x${H} (Node + CanvasKit CPU raster; not phone numbers)\n${rows.join('\n')}\n`,
    );
  });

  it('runs the whole editing and export path within sane bounds', async () => {
    // synthetic product: a dark ellipse with a soft rim on a grey surface
    const rgba = new Uint8Array(W * H * 4);
    const flat = new Uint8Array(W * H);
    await step('build photo + mask bytes (test setup)', () => {
      const cx = W / 2;
      const cy = H / 2;
      const rx = W * 0.3;
      const ry = H * 0.3;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          const i = y * W + x;
          const inside = d <= 1;
          const rim = Math.min(1, Math.max(0, (1.02 - d) / 0.04)); // ~ soft, like an upscaled model mask
          flat[i] = Math.round(255 * rim);
          const v = inside ? 30 : 160;
          rgba[i * 4] = v;
          rgba[i * 4 + 1] = v + 4;
          rgba[i * 4 + 2] = v + 10;
          rgba[i * 4 + 3] = 255;
        }
    });
    const photo: SkImage = await step('photo as a Skia image', () =>
      Skia.Image.MakeImage(
        { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
        Skia.Data.fromBytes(rgba),
        W * 4,
      )!,
    );
    const mask = await step('TiledMask.fromFlat', () => TiledMask.fromFlat(flat, W, H));
    const bounds = await step('maskTightBounds (exact, full resolution)', () =>
      maskTightBounds(mask),
    );
    expect(bounds).not.toBeNull();
    const doc = await step(
      'open EditorDoc (pyramid object, tiles)',
      () => new EditorDoc('p', photo, mask),
    );
    await step('analysis copy (1024 px) + Lab', () => doc.analysis);
    await step('wand tap (1 MP flood fill) + upsample + snap', () =>
      doc.selectWand(
        { x: W / 2, y: H / 2 },
        { tolerance: 20, contiguous: true, edgeAware: true, edgeSensitivity: 0.5 },
        'replace',
        false,
      ),
    );
    await step('Remove selection (tile composite)', () => doc.applySelection('remove'));
    await step('Undo', () => doc.undo());
    await step('brush stroke 600 px long (tile composite)', () =>
      doc.commitStroke({
        mode: 'erase',
        size: 120,
        softness: 0.4,
        opacity: 1,
        points: Array.from({ length: 30 }, (_, k) => ({
          x: W * 0.35 + k * 20,
          y: H * 0.5 + Math.sin(k) * 40,
        })),
      }),
    );
    for (let k = 0; k < 20; k++)
      doc.commitStroke({
        mode: 'restore',
        size: 80,
        softness: 0.3,
        opacity: 1,
        points: [
          { x: W * 0.4 + k * 30, y: H * 0.45 },
          { x: W * 0.4 + k * 30 + 90, y: H * 0.5 },
        ],
      });
    rows.push(
      `undo history after 21 strokes: ${doc.history.size} steps, ${(doc.history.bytes / 1024).toFixed(0)} KB compressed`,
    );
    expect(doc.history.bytes).toBeLessThan(50 * 1024 * 1024);
    await step('clean-up suggestions (analysis copy)', () =>
      suggestCleanups({
        rgba: doc.analysis.rgba,
        alpha: doc.maskAtAnalysis(),
        w: doc.analysis.w,
        h: doc.analysis.h,
      }),
    );
    const refined = await step('refineMask: matting over the whole mask', () =>
      refineMask(photo, doc.mask, DEFAULT_REFINE, { bandRadius: 12 }),
    );
    await step('refineMask + shift/smooth/soften', () =>
      refineMask(
        photo,
        doc.mask,
        { ...DEFAULT_REFINE, shift: 2, smooth: 4, softness: 2 },
        { bandRadius: 12 },
      ),
    );
    const patches = await step('decontamination patches', () =>
      decontaminationPatches(photo, refined),
    );
    rows.push(`patches: ${patches.length}`);
    const src = sourceFromParts(photo, doc.mask, DEFAULT_EDIT_STATE);
    const product = await step('build premultiplied cut-out', () => toProductInputs(src));
    const out = await step('render + encode PNG (original canvas)', () =>
      renderComposite(
        product,
        {
          canvas: { ...DEFAULT_EDIT_STATE.canvas, aspect: 'original', paddingPercent: 4 },
          transform: DEFAULT_EDIT_STATE.transform,
          shadow: DEFAULT_EDIT_STATE.shadow,
          background: DEFAULT_EDIT_STATE.background,
          fill: null,
        },
        { format: 'png', quality: 100, maxBytes: null },
      ),
    );
    rows.push(`export size ${out.width}x${out.height}, PNG ${mb(out.bytes.length)}`);
    await step('render 2000x2000 white JPEG with natural shadow', () =>
      renderComposite(
        product,
        {
          canvas: {
            ...DEFAULT_EDIT_STATE.canvas,
            aspect: '1:1',
            width: 2000,
            height: 2000,
            paddingPercent: 4,
          },
          transform: DEFAULT_EDIT_STATE.transform,
          shadow: { ...DEFAULT_EDIT_STATE.shadow, kind: 'natural' },
          background: { kind: 'color', color: '#FFFFFF' },
          fill: 0.85,
        },
        { format: 'jpeg', quality: 92, maxBytes: null },
      ),
    );
    expect(out.width).toBeGreaterThan(W * 0.55);
    // keep makeAnalysis referenced for the bundler-free import check
    void makeAnalysis;
  }, 900000);
});
