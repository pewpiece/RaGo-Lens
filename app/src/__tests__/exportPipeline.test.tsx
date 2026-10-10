/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import {
  applyDrag,
  applyTwo,
  nudge,
  resetTransform,
  rotateBy,
  two,
} from '@/compose/composeGesture';
import { renderComposite, type ComposeSpec } from '@/compose/render';
import { DEFAULT_EDIT_STATE } from '@/edit/editState';
import { sourceFromParts, toProductInputs } from '@/export/productSource';
import { TiledMask } from '@/mask/tiledMask';
import { SEED_PRESETS } from '@/presets/presets';
import { analyzeAndCheck, cleanupCounts } from '@/readiness/analyze';
import { objectWithBlob, objectWithHoles, type Fixture } from '../../test/fixtures';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const photoOf = (f: Fixture): SkImage =>
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
const E = DEFAULT_EDIT_STATE;
const squareWhite = SEED_PRESETS.find((p) => p.id === 'square-white-2000')!;

describe('from a stored product to a checked export', () => {
  it('white-square preset: placed at the target fill, opaque, checks run on the real picture', async () => {
    const f = objectWithBlob(600, 400);
    const src = sourceFromParts(photoOf(f), TiledMask.fromFlat(f.truth, f.width, f.height), E);
    expect(src.bounds).not.toBeNull();
    const product = await toProductInputs(src);
    const spec: ComposeSpec = {
      canvas: {
        ...E.canvas,
        aspect: squareWhite.canvas.aspect,
        width: 800,
        height: 800,
        paddingPercent: 4,
      },
      transform: E.transform,
      shadow: { ...E.shadow, kind: 'contact', opacity: 0.4 },
      background: squareWhite.background,
      fill: squareWhite.fill.target,
    };
    const fmt = { format: 'jpeg' as const, quality: 92, maxBytes: null };
    const rendered = await renderComposite(product, spec, fmt);
    expect([rendered.width, rendered.height]).toEqual([800, 800]);
    const checks = await analyzeAndCheck(
      product,
      spec,
      fmt,
      { ...squareWhite, canvas: { ...squareWhite.canvas, width: 800, height: 800 } },
      rendered,
      cleanupCounts(src),
    );
    const by = (id: string) => checks.find((c) => c.id === id)!;
    expect(by('fill').status).toBe('pass');
    expect(by('centre').status).toBe('pass');
    expect(by('transparency').status).toBe('pass');
    expect(by('leftovers').status).toBe('pass');
    expect(by('background').status).toBe('pass');
    // a 312 px wide product blown up to 85 % of 800 px is an enlargement of about 2.2x: the checker says so
    expect(by('resolution').status).toBe('warn');
    expect(by('resolution').detail).toMatch(/enlarged 2\.\d+x/);
  });

  it("the model's mistakes show up as readiness warnings with a fix that opens the editor", async () => {
    const f = objectWithHoles(600, 300);
    const src = sourceFromParts(photoOf(f), TiledMask.fromFlat(f.modelMask, f.width, f.height), E); // holes still filled
    const product = await toProductInputs(src);
    const spec: ComposeSpec = {
      canvas: { ...E.canvas, aspect: 'original', paddingPercent: 4 },
      transform: E.transform,
      shadow: E.shadow,
      background: { kind: 'transparent' },
      fill: null,
    };
    const fmt = { format: 'png' as const, quality: 100, maxBytes: null };
    const rendered = await renderComposite(product, spec, fmt);
    const checks = await analyzeAndCheck(product, spec, fmt, null, rendered, cleanupCounts(src));
    const holes = checks.find((c) => c.id === 'holes')!;
    expect(holes.status).toBe('warn');
    expect(holes.detail).toMatch(/8 opening/);
    expect(holes.fix?.action.kind).toBe('editor');
  });

  it('refinement settings flow through: a grown edge exports a bigger picture', async () => {
    const f = objectWithBlob(600, 400);
    const plain = sourceFromParts(photoOf(f), TiledMask.fromFlat(f.truth, f.width, f.height), E);
    const grown = sourceFromParts(photoOf(f), TiledMask.fromFlat(f.truth, f.width, f.height), {
      ...E,
      refine: { ...E.refine, shift: 6 },
    });
    expect(grown.bounds!.right - grown.bounds!.left).toBeGreaterThan(
      plain.bounds!.right - plain.bounds!.left + 8,
    );
  });
});

describe('compose gestures', () => {
  const canvas = { w: 1000, h: 1000 };
  const T = E.transform;
  it('one finger moves the product and sticks to the centre lines', () => {
    const moved = applyDrag(T, 50, -30, 0.5, canvas); // 50 preview px = 100 canvas px = 0.1
    expect(moved.t.cx).toBeCloseTo(0.6, 9);
    expect(moved.t.cy).toBeCloseTo(0.44, 9);
    const sticky = applyDrag({ ...T, cx: 0.4 }, 49, 0, 0.5, canvas); // lands at 0.498 -> snaps to 0.5
    expect(sticky.t.cx).toBe(0.5);
    expect(sticky.guides.guideX).toBe(true);
  });
  it('pinch scales, twist rotates with snapping at 90, and the centroid pans', () => {
    const a = two({ x: 100, y: 100 }, { x: 200, y: 100 });
    const b = two({ x: 100, y: 100 }, { x: 300, y: 100 });
    expect(applyTwo(T, a, b, 1, canvas).t.scale).toBeCloseTo(2, 9);
    const twisted = two({ x: 100, y: 100 }, { x: 100, y: 200 }); // line turned by +90 degrees
    const r = applyTwo(T, a, twisted, 1, canvas);
    expect(r.t.rotation).toBe(90);
    expect(r.guides.rotation).toBe(true);
    const near = two(
      { x: 100, y: 100 },
      { x: 100 + 100 * Math.cos(0.3), y: 100 + 100 * Math.sin(0.3) },
    ); // 17 degrees: no snap
    expect(applyTwo(T, a, near, 1, canvas).t.rotation).toBeCloseTo(17.19, 1);
    expect(applyTwo(T, a, two({ x: 160, y: 100 }, { x: 260, y: 100 }), 1, canvas).t.cx).toBeCloseTo(
      0.56,
      9,
    );
    expect(applyTwo({ ...T, scale: 7.9 }, a, b, 1, canvas).t.scale).toBe(8);
  });
  it('nudge, rotate by 90, reset', () => {
    expect(nudge(T, 10, -5, canvas)).toMatchObject({ cx: 0.51, cy: 0.495 });
    expect(rotateBy(T, 90).rotation).toBe(90);
    expect(rotateBy(rotateBy(T, 90), 90).rotation).toBe(180);
    expect(rotateBy(rotateBy(T, 90), -180).rotation).toBe(-90);
    expect(resetTransform({ ...T, rotation: 33, flipH: true, scale: 3, cx: 0.9, cy: 0.1 })).toEqual(
      T,
    );
  });
});
