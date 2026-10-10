import { suggestCleanups, type AnalysisInput } from '@/editor/suggest';
import { darkOnDark, objectWithBlob, objectWithHoles, type Fixture } from '../../test/fixtures';

const inputOf = (f: Fixture, mask: Uint8Array): AnalysisInput => ({
  rgba: f.rgba,
  alpha: mask,
  w: f.width,
  h: f.height,
});
const covered = (s: { bbox: number[]; region: Uint8Array }, x: number, y: number) => {
  const [l, t, r] = s.bbox as [number, number, number, number];
  if (x < l || y < t || x >= r) return false;
  return s.region[(y - t) * (r - l) + (x - l)] === 255;
};

describe('clean-up suggestions', () => {
  it('flags every strap hole and the slot that the model filled in (7 holes + 1 slot)', () => {
    const f = objectWithHoles();
    const s = suggestCleanups(inputOf(f, f.modelMask));
    const holes = s.filter((x) => x.kind === 'hole');
    expect(holes).toHaveLength(8);
    // every true hole pixel is covered by exactly one suggestion; no opaque strap pixel is
    let missed = 0;
    let wrong = 0;
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++) {
        const i = y * f.width + x;
        const isHole = f.modelMask[i] === 255 && f.truth[i] === 0;
        const hit = holes.some((h) => covered(h, x, y));
        if (isHole && !hit) missed++;
        if (!isHole && hit) wrong++;
      }
    expect(missed).toBe(0);
    expect(wrong).toBe(0);
    expect(holes.every((h) => h.action === 'remove')).toBe(true);
  });

  it('a solid object with nothing wrong gets no suggestions', () => {
    const f = objectWithHoles();
    expect(suggestCleanups(inputOf(f, f.truth)).filter((s) => s.kind === 'hole')).toHaveLength(0);
    const g = darkOnDark();
    expect(suggestCleanups(inputOf(g, g.truth))).toEqual([]);
  });

  it('a true opaque interior feature (a bright print on the product) is not flagged as a hole', () => {
    const f = objectWithHoles();
    const rgba = f.rgba.slice();
    // paint a bright, non-background-coloured label inside the strap and keep it opaque in the mask
    for (let y = 120; y < 150; y++)
      for (let x = 60; x < 100; x++) rgba.set([240, 60, 60, 255], (y * f.width + x) * 4);
    const s = suggestCleanups({ rgba, alpha: f.modelMask, w: f.width, h: f.height });
    expect(s.some((x) => covered(x, 80, 135))).toBe(false);
  });

  it('proposes the logo stuck to the product through a narrow neck, and not the product', () => {
    const f = objectWithBlob();
    const s = suggestCleanups(inputOf(f, f.modelMask));
    const blobs = s.filter((x) => x.kind === 'blob');
    expect(blobs).toHaveLength(1);
    const b = blobs[0]!;
    expect(covered(b, Math.round(f.width * 0.82), Math.round(f.height * 0.5))).toBe(true);
    expect(covered(b, Math.round(f.width * 0.4), Math.round(f.height * 0.5))).toBe(false);
    // removing it reproduces the true mask (within the neck stub the model also kept)
    let wrongRemoved = 0;
    for (let y = 0; y < f.height; y++)
      for (let x = 0; x < f.width; x++)
        if (covered(b, x, y) && f.truth[y * f.width + x] === 255) wrongRemoved++;
    expect(wrongRemoved).toBe(0);
  });

  it('flags detached specks and tiny pin-holes', () => {
    const f = objectWithBlob(600, 400);
    const m = f.truth.slice();
    for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) m[y * f.width + x] = 255; // speck far from the product
    m[200 * f.width + 240] = 0; // pin-hole in the middle of the product
    const s = suggestCleanups(inputOf(f, m));
    expect(s.some((x) => x.kind === 'speck' && covered(x, 21, 21))).toBe(true);
    expect(s.some((x) => x.kind === 'pinhole' && x.action === 'keep' && covered(x, 240, 200))).toBe(
      true,
    );
  });
});
