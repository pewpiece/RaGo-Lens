/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { MaskHistory } from '@/mask/history';
import { TiledMask } from '@/mask/tiledMask';
import { applySmartStroke, makeAnalysis } from '@/editor/analysis';
import { magicWand } from '@/editor/wand';
import {
  adjustSelection,
  applySelectionToMask,
  applyShapeToSelection,
  applyStroke,
  invertSelection,
  mergeSelection,
  selectionBounds,
  selectionIsEmpty,
  upsampleSelection,
} from '@/editor/tileOps';
import { objectWithBlob, type Fixture } from '../../test/fixtures';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const full = (w: number, h: number, v = 255) => {
  const m = new TiledMask(w, h, v);
  return m;
};
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

describe('brush strokes on the tiled mask', () => {
  const W = 1100;
  const H = 700;
  const stroke = (over: Partial<Parameters<typeof applyStroke>[1]> = {}) => ({
    mode: 'erase' as const,
    size: 40,
    softness: 0,
    opacity: 1,
    points: [
      { x: 400, y: 500 },
      { x: 700, y: 500 },
    ],
    ...over,
  });

  it('erases along the path (across a tile border) and nothing else', () => {
    const m = full(W, H);
    applyStroke(m, stroke(), null);
    expect(m.get(600, 500)).toBe(0);
    expect(m.get(512, 500)).toBe(0); // on the tile border
    expect(m.get(600, 500 + 30)).toBe(255);
    expect(m.get(300, 500)).toBe(255);
    expect(m.get(600, 460)).toBe(255);
  });

  it('restore brings coverage back; opacity and softness give partial values', () => {
    const m = full(W, H, 0);
    applyStroke(m, stroke({ mode: 'restore' }), null);
    expect(m.get(600, 500)).toBe(255);
    applyStroke(
      m,
      stroke({
        mode: 'erase',
        opacity: 0.5,
        points: [
          { x: 600, y: 500 },
          { x: 650, y: 500 },
        ],
      }),
      null,
    );
    const v = m.get(620, 500);
    expect(v).toBeGreaterThan(110);
    expect(v).toBeLessThan(145);
    const soft = full(W, H);
    applyStroke(soft, stroke({ softness: 1, size: 60 }), null);
    const edge = soft.get(550, 500 + 22);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('a stroke is one undo step and undo restores the exact bytes', () => {
    const m = full(W, H);
    const before = m.toFlat();
    const h = new MaskHistory();
    const s = h.begin(m, 'erase');
    applyStroke(
      m,
      stroke({
        points: [
          { x: 100, y: 100 },
          { x: 900, y: 600 },
        ],
      }),
      s,
    );
    s.commit();
    expect(m.get(500, 350)).toBe(0);
    h.undo(m);
    expect(Array.from(m.toFlat())).toEqual(Array.from(before));
  });
});

describe('selections', () => {
  const W = 1100;
  const H = 700;
  const sel = () => new TiledMask(W, H, 0);

  it('rect, ellipse and lasso fill their shapes; modes combine them', () => {
    const s = sel();
    applyShapeToSelection(s, { kind: 'rect', x: 100, y: 100, w: 300, h: 200 }, 'replace');
    expect(s.get(200, 200)).toBe(255);
    expect(s.get(450, 200)).toBe(0);
    applyShapeToSelection(s, { kind: 'ellipse', x: 300, y: 150, w: 300, h: 200 }, 'add');
    expect(s.get(450, 250)).toBe(255);
    applyShapeToSelection(s, { kind: 'rect', x: 150, y: 150, w: 100, h: 100 }, 'subtract');
    expect(s.get(200, 200)).toBe(0);
    expect(s.get(120, 120)).toBe(255);
    applyShapeToSelection(
      s,
      {
        kind: 'path',
        points: [
          { x: 0, y: 0 },
          { x: 350, y: 0 },
          { x: 350, y: 140 },
          { x: 0, y: 140 },
        ],
      },
      'intersect',
    );
    expect(s.get(120, 120)).toBe(255);
    expect(s.get(450, 250)).toBe(0);
    expect(s.get(120, 250)).toBe(0);
  });

  it('invert flips coverage; replace clears the old selection', () => {
    const s = sel();
    applyShapeToSelection(s, { kind: 'rect', x: 10, y: 10, w: 20, h: 20 }, 'replace');
    invertSelection(s);
    expect(s.get(15, 15)).toBe(0);
    expect(s.get(500, 500)).toBe(255);
    expect(s.get(0, 0)).toBe(255);
    applyShapeToSelection(s, { kind: 'rect', x: 600, y: 300, w: 10, h: 10 }, 'replace');
    expect(s.get(500, 500)).toBe(0);
    expect(s.get(605, 305)).toBe(255);
  });

  it('Remove and Keep act on exactly the selected pixels', () => {
    const m = full(W, H);
    const s = sel();
    applyShapeToSelection(s, { kind: 'ellipse', x: 400, y: 200, w: 200, h: 200 }, 'replace');
    const h = new MaskHistory();
    const sess = h.begin(m, 'remove');
    applySelectionToMask(m, s, 'remove', sess);
    sess.commit();
    expect(m.get(500, 300)).toBe(0);
    expect(m.get(300, 300)).toBe(255);
    applySelectionToMask(m, s, 'keep', null);
    expect(m.get(500, 300)).toBe(255);
    h.undo(m);
    expect(m.get(500, 300)).toBe(255);
    expect(selectionIsEmpty(s)).toBe(false);
  });

  it('merges a second selection with modes; feather softens, grow and shrink move the edge', () => {
    const a = sel();
    const b = sel();
    applyShapeToSelection(a, { kind: 'rect', x: 100, y: 100, w: 100, h: 100 }, 'replace');
    applyShapeToSelection(b, { kind: 'rect', x: 150, y: 150, w: 100, h: 100 }, 'replace');
    mergeSelection(a, b, 'intersect');
    expect(a.get(175, 175)).toBe(255);
    expect(a.get(120, 120)).toBe(0);
    expect(a.get(225, 225)).toBe(0);
    const g = sel();
    applyShapeToSelection(g, { kind: 'rect', x: 300, y: 300, w: 60, h: 60 }, 'replace');
    adjustSelection(g, { kind: 'grow', radius: 6 });
    expect(g.get(296, 330)).toBe(255);
    expect(g.get(290, 330)).toBe(0);
    adjustSelection(g, { kind: 'shrink', radius: 12 });
    expect(g.get(302, 330)).toBe(0);
    expect(g.get(330, 330)).toBe(255);
    const f = sel();
    applyShapeToSelection(f, { kind: 'rect', x: 300, y: 300, w: 60, h: 60 }, 'replace');
    adjustSelection(f, { kind: 'feather', radius: 10 });
    const e = f.get(300, 330);
    expect(e).toBeGreaterThan(20);
    expect(e).toBeLessThan(235);
    expect(selectionBounds(f)!.w).toBeGreaterThan(60);
  });
});

describe('wand -> full-resolution selection (the Dell-logo case, at 2x the analysis size)', () => {
  it('one tap selects the attached logo at full resolution; Remove gives the true cut-out', () => {
    const f = objectWithBlob(1200, 800);
    const photo = photoOf(f);
    const a = makeAnalysis(photo, 600); // analysis copy is half size
    expect([a.w, a.h]).toEqual([600, 400]);
    const seed = { x: Math.round(f.width * 0.82) / a.kx, y: Math.round(f.height * 0.5) / a.ky };
    const small = magicWand(a.lab, a.w, a.h, seed, {
      tolerance: 20,
      contiguous: true,
      edgeAware: true,
      edgeSensitivity: 0.5,
    });
    const sel = upsampleSelection(small, a.w, a.h, photo);
    const mask = TiledMask.fromFlat(f.modelMask, f.width, f.height);
    applySelectionToMask(mask, sel, 'remove', null);
    // compare with the true mask: nearly every pixel agrees, and edge error is at most a pixel or two
    const out = mask.toFlat();
    let bad = 0;
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]! - f.truth[i]!) > 128) bad++;
    const logoArea = Math.PI * Math.round(f.height * 0.13) ** 2;
    expect(bad).toBeLessThan(logoArea * 0.08 + 400); // small residue: the neck stub the wand did not select
    // the product itself is untouched
    expect(mask.get(Math.round(f.width * 0.4), Math.round(f.height * 0.5))).toBe(255);
    expect(mask.get(Math.round(f.width * 0.82), Math.round(f.height * 0.5))).toBe(0);
  });
});

describe('smart brush', () => {
  it('erasing over the boundary only removes pixels that look like the colour under the brush', () => {
    const f = objectWithBlob(600, 400);
    const photo = photoOf(f);
    const a = makeAnalysis(photo, 600);
    const mask = TiledMask.fromFlat(
      f.truth.map((v, i) => (v ? 255 : f.modelMask[i]! ? 255 : 0)),
      f.width,
      f.height,
    );
    // brush centred on the logo's left edge, big enough to also cover product pixels
    const y = Math.round(f.height * 0.5);
    const cx = Math.round(f.width * 0.82 - f.height * 0.13) + 4; // just inside the logo
    const s = {
      mode: 'erase' as const,
      size: 160,
      softness: 0,
      opacity: 1,
      points: [{ x: cx, y }],
    };
    applySmartStroke(mask, s, a, { tolerance: 20, edgeSensitivity: 0.6 }, null);
    expect(mask.get(Math.round(f.width * 0.82), y)).toBe(0); // logo gone
    expect(mask.get(Math.round(f.width * 0.4 + f.width * 0.2), y)).toBe(255); // product untouched (inside the brush circle? no, far)
    // a plain brush of the same size WOULD have hit product pixels inside the circle
    const plain = TiledMask.fromFlat(f.modelMask, f.width, f.height);
    applyStroke(plain, s, null);
    const probe = { x: cx - 60, y: y }; // inside the circle, on the product side
    expect(f.truth[probe.y * f.width + probe.x]).toBe(255);
    expect(plain.get(probe.x, probe.y)).toBe(0);
    expect(mask.get(probe.x, probe.y)).toBe(255);
  });
});
