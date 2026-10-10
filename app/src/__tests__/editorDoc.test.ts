/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { EditorDoc } from '@/editor/doc';
import { TiledMask } from '@/mask/tiledMask';
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
const docOf = (f: Fixture, mask: Uint8Array) =>
  new EditorDoc('t', photoOf(f), TiledMask.fromFlat(mask, f.width, f.height));
const same = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);

describe('EditorDoc: the Dell-logo and strap-hole workflows end to end', () => {
  it('tap the logo -> Remove -> the mask equals the true cut-out around it; undo/redo are exact', () => {
    const f = objectWithBlob(900, 600);
    const doc = docOf(f, f.modelMask);
    const before = doc.mask.toFlat();
    doc.selectWand(
      { x: Math.round(f.width * 0.82), y: Math.round(f.height * 0.5) },
      { tolerance: 20, contiguous: true, edgeAware: true, edgeSensitivity: 0.5 },
      'replace',
      false,
    );
    expect(doc.hasSelection).toBe(true);
    doc.applySelection('remove');
    expect(doc.hasSelection).toBe(false);
    expect(doc.dirty).toBe(true);
    expect(doc.mask.get(Math.round(f.width * 0.82), Math.round(f.height * 0.5))).toBe(0);
    expect(doc.mask.get(Math.round(f.width * 0.4), Math.round(f.height * 0.5))).toBe(255);
    const after = doc.mask.toFlat();
    doc.undo();
    expect(same(doc.mask.toFlat(), before)).toBe(true);
    doc.redo();
    expect(same(doc.mask.toFlat(), after)).toBe(true);
  });

  it('suggestions are computed on demand, accepted one at a time, and never applied silently', () => {
    const f = objectWithHoles(900, 450);
    const doc = docOf(f, f.modelMask);
    const before = doc.mask.toFlat();
    const sugg = doc.computeSuggestions();
    expect(sugg.filter((s) => s.kind === 'hole')).toHaveLength(8);
    expect(same(doc.mask.toFlat(), before)).toBe(true); // analysis changed nothing
    const first = sugg.find((s) => s.kind === 'hole')!;
    doc.acceptSuggestion(first.id);
    expect(same(doc.mask.toFlat(), before)).toBe(false);
    expect(doc.history.canUndo).toBe(true);
    expect(doc.computeSuggestions().filter((s) => s.kind === 'hole')).toHaveLength(7);
    // dismiss leaves the mask alone
    const next = doc.computeSuggestions().find((s) => s.kind === 'hole')!;
    const snap = doc.mask.toFlat();
    doc.dismissSuggestion(next.id);
    expect(same(doc.mask.toFlat(), snap)).toBe(true);
    expect(doc.computeSuggestions().some((s) => s.id === next.id)).toBe(false);
    // accepting all remaining holes gives the true mask almost exactly
    for (const s of doc.computeSuggestions().filter((x) => x.kind === 'hole'))
      doc.acceptSuggestion(s.id);
    // (one hole was dismissed, so it stays closed) -> everything else matches the truth
    const out = doc.mask.toFlat();
    let bad = 0;
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]! - f.truth[i]!) > 128) bad++;
    // the only wrong pixels are the dismissed opening (analysis scale is 1 here) plus a thin edge ring
    expect(bad).toBeLessThan(next.area * 1.1 + 300);
    expect(bad).toBeGreaterThan(next.area * 0.8);
  });

  it('brush strokes are undoable and mark the document dirty; the selection never touches the mask until applied', () => {
    const f = objectWithBlob(600, 400);
    const doc = docOf(f, f.truth);
    const snap = doc.mask.toFlat();
    doc.selectShape({ kind: 'rect', x: 100, y: 100, w: 120, h: 120 }, 'replace');
    expect(same(doc.mask.toFlat(), snap)).toBe(true);
    doc.commitStroke({
      mode: 'erase',
      size: 30,
      softness: 0,
      opacity: 1,
      points: [
        { x: 200, y: 200 },
        { x: 260, y: 200 },
      ],
    });
    expect(doc.mask.get(230, 200)).toBe(0);
    doc.undo();
    expect(same(doc.mask.toFlat(), snap)).toBe(true);
    expect(doc.history.size).toBe(1);
  });

  it('rotating the photo moves the mask with it (90 degrees clockwise)', () => {
    const f = objectWithBlob(600, 400);
    const doc = docOf(f, f.truth);
    const probe = { x: Math.round(f.width * 0.4), y: Math.round(f.height * 0.5) }; // inside the product
    doc.transformPhoto(1);
    expect([doc.width, doc.height]).toEqual([400, 600]);
    // clockwise: (x, y) -> (H - 1 - y, x)
    expect(doc.mask.get(f.height - 1 - probe.y, probe.x)).toBe(255);
    expect(doc.mask.get(0, 0)).toBe(0);
    expect(doc.photoChanged).toBe(true);
    expect(doc.history.canUndo).toBe(false);
  });

  it('refinement settings are non-destructive: the base mask stays, the export mask is refined, defaults are free', () => {
    const f = objectWithBlob(600, 400);
    const doc = docOf(f, f.truth);
    const base = doc.mask.toFlat();
    expect(doc.finalMask()).toBe(doc.mask); // default settings: no work, same object
    doc.setRefine({ ...doc.refine, shift: 4 });
    expect(doc.editDirty).toBe(true);
    const fin = doc.finalMask();
    expect(fin).not.toBe(doc.mask);
    expect(Array.from(doc.mask.toFlat())).toEqual(Array.from(base)); // base mask untouched
    // the oval grew by about 4 px at its left edge (x = 0.4*600 - 0.26*600 = 84)
    expect(fin.get(81, 200)).toBeGreaterThan(150);
    expect(doc.mask.get(81, 200)).toBe(0);
    // cached until the mask changes
    expect(doc.finalMask()).toBe(fin);
    doc.commitStroke({
      mode: 'erase',
      size: 20,
      softness: 0,
      opacity: 1,
      points: [{ x: 240, y: 200 }],
    });
    expect(doc.finalMask()).not.toBe(fin);
  });
});
