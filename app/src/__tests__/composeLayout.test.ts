import { DEFAULT_EDIT_STATE } from '@/edit/editState';
import {
  canvasSizeFor,
  framingStats,
  framingTransform,
  placeProduct,
  rotatedExtent,
  sizeForAspect,
  snapCentre,
  snapRotation,
} from '@/compose/layout';

const T = DEFAULT_EDIT_STATE.transform;
const bounds = { left: 100, top: 50, right: 500, bottom: 250 }; // 400 x 200

describe('rotation extents and snapping', () => {
  it('the box of a rotated rectangle is right at the key angles', () => {
    expect(rotatedExtent(400, 200, 0)).toEqual({ w: 400, h: 200 });
    const r90 = rotatedExtent(400, 200, 90);
    expect(r90.w).toBeCloseTo(200, 6);
    expect(r90.h).toBeCloseTo(400, 6);
    const r45 = rotatedExtent(400, 200, 45);
    expect(r45.w).toBeCloseTo(424.26, 1);
    expect(r45.h).toBeCloseTo(424.26, 1);
    expect(rotatedExtent(400, 200, -30)).toEqual(rotatedExtent(400, 200, 30));
  });
  it('snaps near 0, 90, 180 and 270 (as -90) and leaves other angles alone', () => {
    expect(snapRotation(2)).toEqual({ deg: 0, snapped: true });
    expect(snapRotation(-2.5)).toEqual({ deg: 0, snapped: true });
    expect(snapRotation(88)).toEqual({ deg: 90, snapped: true });
    expect(snapRotation(-91)).toEqual({ deg: -90, snapped: true });
    expect(snapRotation(179)).toEqual({ deg: 180, snapped: true });
    expect(snapRotation(-179)).toEqual({ deg: 180, snapped: true });
    expect(snapRotation(270)).toEqual({ deg: -90, snapped: true });
    expect(snapRotation(30)).toEqual({ deg: 30, snapped: false });
  });
  it('snaps to the canvas centre lines and reports the guides', () => {
    expect(snapCentre(0.508, 0.3)).toEqual({ cx: 0.5, cy: 0.3, guideX: true, guideY: false });
    expect(snapCentre(0.4, 0.497)).toEqual({ cx: 0.4, cy: 0.5, guideX: false, guideY: true });
  });
});

describe('canvas sizes', () => {
  it('"original" is the product size plus 4 % padding, in the photo\'s own pixels, never enlarged', () => {
    const c = canvasSizeFor(
      { ...DEFAULT_EDIT_STATE.canvas, aspect: 'original', paddingPercent: 4 },
      bounds,
      0,
    );
    expect(c).toEqual({ w: 432, h: 232 });
    const r = canvasSizeFor(
      { ...DEFAULT_EDIT_STATE.canvas, aspect: 'original', paddingPercent: 4 },
      bounds,
      90,
    );
    expect(r).toEqual({ w: 232, h: 432 });
  });
  it('fixed aspects and custom sizes', () => {
    expect(sizeForAspect('1:1', 2000)).toEqual({ w: 2000, h: 2000 });
    expect(sizeForAspect('4:5', 2000)).toEqual({ w: 1600, h: 2000 });
    expect(sizeForAspect('16:9', 1920)).toEqual({ w: 1920, h: 1080 });
    expect(sizeForAspect('9:16', 1920)).toEqual({ w: 1080, h: 1920 });
    expect(
      canvasSizeFor(
        { ...DEFAULT_EDIT_STATE.canvas, aspect: 'custom', width: 1234, height: 987 },
        bounds,
        0,
      ),
    ).toEqual({ w: 1234, h: 987 });
  });
});

describe('placing the product', () => {
  it('fill 0.85 on a square canvas: the product takes 85 % of the canvas along its tighter axis, centred', () => {
    const canvas = { w: 2000, h: 2000 };
    const p = placeProduct(bounds, T, canvas, 0.85);
    const s = framingStats(p.box, canvas);
    expect(s.fill).toBeCloseTo(0.85, 6);
    expect(s.centreOffsetX).toBeCloseTo(0, 9);
    expect(s.centreOffsetY).toBeCloseTo(0, 9);
    expect(p.k).toBeCloseTo((0.85 * 2000) / 400, 6);
  });
  it('scale, position and rotation move the box as expected; natural size keeps 1:1', () => {
    const canvas = { w: 432, h: 232 };
    const p1 = placeProduct(bounds, T, canvas, null);
    expect(p1.k).toBe(1);
    expect(p1.box.right - p1.box.left).toBeCloseTo(400, 6);
    const p2 = placeProduct(bounds, { ...T, scale: 0.5, cx: 0.25, cy: 0.75 }, canvas, null);
    expect(p2.box.right - p2.box.left).toBeCloseTo(200, 6);
    expect((p2.box.left + p2.box.right) / 2).toBeCloseTo(108, 6);
    expect((p2.box.top + p2.box.bottom) / 2).toBeCloseTo(174, 6);
    const p3 = placeProduct(bounds, { ...T, rotation: 90 }, { w: 1000, h: 1000 }, 0.8);
    expect(p3.box.bottom - p3.box.top).toBeCloseTo(800, 6); // rotated: the 400 side is now vertical and is the tight axis
  });
  it('framingTransform reaches the target fill and centres, or sits on a baseline', () => {
    const canvas = { w: 1000, h: 1000 };
    const t = framingTransform(bounds, { ...T, scale: 2, cx: 0.2, cy: 0.9 }, canvas, 0.8, 'centre');
    expect([t.scale, t.cx, t.cy]).toEqual([1, 0.5, 0.5]);
    const s = framingStats(placeProduct(bounds, t, canvas, 0.8).box, canvas);
    expect(s.fill).toBeCloseTo(0.8, 6);
    const tb = framingTransform(bounds, T, canvas, 0.8, { baseline: 0.9 });
    expect(placeProduct(bounds, tb, canvas, 0.8).box.bottom).toBeCloseTo(900, 6);
  });
});
