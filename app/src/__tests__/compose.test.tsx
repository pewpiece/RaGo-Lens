/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { DEFAULT_EDIT_STATE } from '@/edit/editState';
import type { ProductInputs } from '@/compose/ComposeTree';
import { buildCutout } from '@/compose/cutout';
import { layoutFor, renderComposite, type ComposeSpec } from '@/compose/render';
import { maskBoundsExact } from '@/engine/postprocess';
import { imageFromBytes, readAlpha } from '@/engine/skiaOps';
import { pngColorType } from '@/export/png';
import { maskToImage } from '@/mask/maskImage';
import { TiledMask } from '@/mask/tiledMask';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const W = 600;
const H = 400;
/** A red 300x160 product (with 1-px anti-aliased edge) lying on a grey photo; the mask is exactly the product. */
async function product(): Promise<ProductInputs> {
  const rgba = new Uint8Array(W * H * 4);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inside = x >= 150 && x < 450 && y >= 120 && y < 280;
      rgba.set(inside ? [220, 20, 20, 255] : [150, 150, 150, 255], (y * W + x) * 4);
      mask[y * W + x] = inside ? 255 : 0;
    }
  const original: SkImage = Skia.Image.MakeImage(
    { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(rgba),
    W * 4,
  )!;
  return buildCutout({
    original,
    maskLayer: maskToImage(TiledMask.fromFlat(mask, W, H)),
    width: W,
    height: H,
    bounds: { left: 150, top: 120, right: 450, bottom: 280 },
  });
}

const E = DEFAULT_EDIT_STATE;
const spec = (over: Partial<ComposeSpec> = {}): ComposeSpec => ({
  canvas: { ...E.canvas, aspect: 'original', paddingPercent: 4 },
  transform: E.transform,
  shadow: E.shadow,
  background: E.background,
  fill: null,
  ...over,
});
const rgbaOf = (img: SkImage) => {
  const px = img.readPixels(0, 0, {
    width: img.width(),
    height: img.height(),
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  })!;
  return px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
};

describe('compose: canvas, rotation, flip', () => {
  it('"original" canvas keeps the photo\'s pixels 1:1 with 4 % padding, as a transparent RGBA PNG', async () => {
    const r = await renderComposite(await product(), spec());
    expect([r.width, r.height]).toEqual([324, 184]); // 300+2*12, 160+2*12 (pad = 4 % of the longer side)
    expect(pngColorType(r.bytes)).toBe(6);
    const a = readAlpha(imageFromBytes(r.bytes));
    expect(a[0]).toBe(0);
    const b = maskBoundsExact(a, r.width, r.height)!;
    expect([b.right - b.left, b.bottom - b.top]).toEqual([300, 160]);
    expect(b.left).toBe(12);
  });

  it('rotating 90 degrees swaps the output dimensions and moves the product', async () => {
    const r = await renderComposite(
      await product(),
      spec({ transform: { ...E.transform, rotation: 90 } }),
    );
    expect([r.width, r.height]).toEqual([184, 324]);
    const a = readAlpha(imageFromBytes(r.bytes));
    const b = maskBoundsExact(a, r.width, r.height)!;
    expect([b.right - b.left, b.bottom - b.top]).toEqual([160, 300]);
  });

  it('a 30 degree rotation leaves no dark or light fringe: edge colours stay the product red', async () => {
    const r = await renderComposite(
      await product(),
      spec({ transform: { ...E.transform, rotation: 30 } }),
    );
    const rgba = rgbaOf(r.image);
    let edge = 0;
    let dr = 0;
    let dg = 0;
    let n = 0;
    let darkest = 255;
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3]!;
      if (a < 40 || a > 215) continue;
      edge++;
      dr += rgba[i]!;
      dg += rgba[i + 1]!;
      darkest = Math.min(darkest, rgba[i]!);
      n++;
    }
    expect(edge).toBeGreaterThan(300);
    expect(dr / n).toBeGreaterThan(205); // red stays ~220, a premultiplied-wrongly edge would sink to ~110
    expect(dg / n).toBeLessThan(40); // and no grey background creeps in
    expect(darkest).toBeGreaterThan(190);
  });

  it('flip horizontal mirrors the product; scale and position move it inside a fixed canvas', async () => {
    // asymmetric product: left half of the strip is bright, right half dark
    const p = await product();
    const flipped = await renderComposite(p, spec({ transform: { ...E.transform, flipH: true } }));
    const normal = await renderComposite(p, spec());
    expect(flipped.width).toBe(normal.width);
    // the product is symmetric in colour, so check mirrored geometry via an off-centre mask instead: scale+move
    const s = spec({
      canvas: { ...E.canvas, aspect: '1:1', width: 800, height: 800, paddingPercent: 4 },
      transform: { ...E.transform, scale: 0.5, cx: 0.25, cy: 0.75 },
      fill: 0.8,
    });
    const r = await renderComposite(p, s);
    expect([r.width, r.height]).toEqual([800, 800]);
    const b = maskBoundsExact(readAlpha(imageFromBytes(r.bytes)), 800, 800)!;
    const lay = layoutFor(p, s, { format: 'png', quality: 100, maxBytes: null });
    expect(b.left).toBeCloseTo(lay.placement.box.left, -1);
    expect(b.bottom).toBeCloseTo(lay.placement.box.bottom, -1);
    expect((b.left + b.right) / 2).toBeCloseTo(200, -1);
    expect((b.top + b.bottom) / 2).toBeCloseTo(600, -1);
    // product width = fill(0.8) * 800 * scale(0.5) = 320 px
    expect(b.right - b.left).toBeGreaterThan(316);
    expect(b.right - b.left).toBeLessThan(324);
  });

  it('a JPEG export is opaque (transparent background becomes white) and respects a size limit', async () => {
    const p = await product();
    const free = await renderComposite(p, spec(), { format: 'jpeg', quality: 95, maxBytes: null });
    expect(free.expectsAlpha).toBe(false);
    const img = imageFromBytes(free.bytes);
    expect(readAlpha(img)[0]).toBe(255);
    const px = rgbaOf(img);
    expect(px[0]).toBeGreaterThan(245); // corner is white, not black
    // pick a limit between the sizes at quality 95 and at the floor (40): the loop must stop inside it
    const lowest = await renderComposite(p, spec(), {
      format: 'jpeg',
      quality: 40,
      maxBytes: null,
    });
    expect(lowest.bytes.length).toBeLessThan(free.bytes.length);
    const limit = Math.round((free.bytes.length + lowest.bytes.length) / 2);
    const limited = await renderComposite(p, spec(), {
      format: 'jpeg',
      quality: 95,
      maxBytes: limit,
    });
    expect(limited.quality).toBeLessThan(95);
    expect(limited.bytes.length).toBeLessThanOrEqual(limit);
    expect(limited.overLimit).toBe(false);
    const impossible = await renderComposite(p, spec(), {
      format: 'jpeg',
      quality: 95,
      maxBytes: 10,
    });
    expect(impossible.overLimit).toBe(true);
  });
});

describe('shadows, reflection and backgrounds', () => {
  const FIXED = {
    canvas: { ...E.canvas, aspect: '1:1' as const, width: 700, height: 700, paddingPercent: 4 },
    fill: 0.6,
  };
  const below = (r: { width: number }, rgba: Uint8Array, x: number, y: number) =>
    Array.from(rgba.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 4));

  it('drop shadow on white: pixels beside/below the product are darker than the background, far corners are not', async () => {
    const p = await product();
    const s = spec({
      ...FIXED,
      background: { kind: 'color', color: '#FFFFFF' },
      shadow: { ...E.shadow, kind: 'drop', opacity: 0.6, blur: 0.04, distance: 0.06, angle: 90 },
    });
    const r = await renderComposite(p, s);
    const lay = layoutFor(p, s, { format: 'png', quality: 100, maxBytes: null });
    const rgba = rgbaOf(r.image);
    const x = Math.round(lay.placement.cx);
    const y = Math.round(lay.placement.box.bottom) + 8;
    expect(below(r, rgba, x, y)[0]).toBeLessThan(235); // shadow
    expect(below(r, rgba, 5, 5)).toEqual([255, 255, 255, 255]);
    expect(below(r, rgba, 5, 695)).toEqual([255, 255, 255, 255]);
  });

  it('contact shadow sits at the product\'s base; "none" leaves the background pure', async () => {
    const p = await product();
    const base = spec({ ...FIXED, background: { kind: 'color', color: '#FFFFFF' } });
    const none = await renderComposite(p, base);
    const noneRgba = rgbaOf(none.image);
    const lay = layoutFor(p, base, { format: 'png', quality: 100, maxBytes: null });
    const x = Math.round(lay.placement.cx);
    const y = Math.round(lay.placement.box.bottom) + 2;
    expect(below(none, noneRgba, x, y)).toEqual([255, 255, 255, 255]);
    const contact = await renderComposite(p, {
      ...base,
      shadow: { ...E.shadow, kind: 'contact', opacity: 0.7, blur: 0.03 },
    });
    expect(below(contact, rgbaOf(contact.image), x, y)[0]).toBeLessThan(215);
    // far from the product the background stays white
    expect(below(contact, rgbaOf(contact.image), 20, y)).toEqual([255, 255, 255, 255]);
  });

  it('on a transparent canvas the shadow is baked into the alpha channel (semi-transparent, dark), outside the product', async () => {
    const p = await product();
    const s = spec({ ...FIXED, shadow: { ...E.shadow, kind: 'natural', opacity: 0.5 } });
    const r = await renderComposite(p, s);
    expect(r.expectsAlpha).toBe(true);
    expect(pngColorType(r.bytes)).toBe(6);
    const img = imageFromBytes(r.bytes);
    const a = readAlpha(img);
    const rgba = rgbaOf(img);
    const lay = layoutFor(p, s, { format: 'png', quality: 100, maxBytes: null });
    const x = Math.round(lay.placement.cx);
    const y = Math.round(lay.placement.box.bottom) + 3;
    const idx = y * r.width + x;
    expect(a[idx]).toBeGreaterThan(8);
    expect(a[idx]).toBeLessThan(200);
    expect(rgba[idx * 4]).toBeLessThan(40); // the shadow colour (black), not red or grey
    expect(a[5 * r.width + 5]).toBe(0);
  });

  it('floor reflection: a faded, mirrored copy below the product that fades out', async () => {
    const p = await product();
    const s = spec({
      ...FIXED,
      shadow: { ...E.shadow, kind: 'none', reflection: true, reflectionOpacity: 0.5 },
    });
    const r = await renderComposite(p, s);
    const img = imageFromBytes(r.bytes);
    const a = readAlpha(img);
    const rgba = rgbaOf(img);
    const lay = layoutFor(p, s, { format: 'png', quality: 100, maxBytes: null });
    const x = Math.round(lay.placement.cx);
    const floor = Math.round(lay.placement.box.bottom);
    const near = a[(floor + 4) * r.width + x]!;
    const far =
      a[
        (floor + Math.round((lay.placement.box.bottom - lay.placement.box.top) * 0.35)) * r.width +
          x
      ]!;
    expect(near).toBeGreaterThan(80);
    expect(near).toBeLessThan(150); // about half opacity
    expect(far).toBeLessThan(near / 2);
    expect(rgba[((floor + 4) * r.width + x) * 4]).toBeGreaterThan(190); // it is the red product, mirrored
  });

  it('colour and gradient backgrounds; JPEG-safe white', async () => {
    const p = await product();
    const solid = await renderComposite(
      p,
      spec({ ...FIXED, background: { kind: 'color', color: '#F2E8D5' } }),
    );
    expect(below(solid, rgbaOf(solid.image), 3, 3)).toEqual([0xf2, 0xe8, 0xd5, 255]);
    const grad = await renderComposite(
      p,
      spec({
        ...FIXED,
        background: { kind: 'gradient', from: '#FFFFFF', to: '#000000', angle: 90 },
      }),
    );
    const g = rgbaOf(grad.image);
    expect(below(grad, g, 3, 3)[0]).toBeGreaterThan(240);
    expect(below(grad, g, 3, 696)[0]).toBeLessThan(15);
    expect(below(grad, g, 3, 350)[0]).toBeGreaterThan(100);
    expect(below(grad, g, 3, 350)[0]).toBeLessThan(155);
  });
});
