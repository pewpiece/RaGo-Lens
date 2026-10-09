import {
  appendPoint,
  canRedo,
  canUndo,
  emptyHistory,
  pushStroke,
  redo,
  softnessBlur,
  undo,
  type Stroke,
} from '@/scene/strokes';
import {
  applyPinch,
  clampPan,
  fitTransform,
  imageToScreen,
  screenToImage,
  twoFinger,
} from '@/scene/viewTransform';

const stroke = (id: number): Stroke => ({
  id,
  mode: 'erase',
  size: 20,
  softness: 0.3,
  points: [{ x: 1, y: 1 }],
});

describe('brush history (undo/redo)', () => {
  it('starts empty with nothing to undo or redo', () => {
    const h = emptyHistory();
    expect([canUndo(h), canRedo(h)]).toEqual([false, false]);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
  it('undoes and redoes in order', () => {
    let h = pushStroke(pushStroke(pushStroke(emptyHistory(), stroke(1)), stroke(2)), stroke(3));
    h = undo(undo(h));
    expect(h.strokes.map((s) => s.id)).toEqual([1]);
    expect(h.redo.map((s) => s.id)).toEqual([3, 2]);
    h = redo(h);
    expect(h.strokes.map((s) => s.id)).toEqual([1, 2]);
    expect(canRedo(h)).toBe(true);
  });
  it('a new stroke clears the redo stack', () => {
    let h = pushStroke(pushStroke(emptyHistory(), stroke(1)), stroke(2));
    h = undo(h);
    h = pushStroke(h, stroke(3));
    expect(h.redo).toEqual([]);
    expect(h.strokes.map((s) => s.id)).toEqual([1, 3]);
  });
  it('does not mutate previous states', () => {
    const a = pushStroke(emptyHistory(), stroke(1));
    undo(a);
    expect(a.strokes).toHaveLength(1);
  });
});

describe('stroke helpers', () => {
  it('soft edge blur scales with brush size and softness, clamped', () => {
    expect(softnessBlur(40, 0)).toBe(0);
    expect(softnessBlur(40, 1)).toBe(20);
    expect(softnessBlur(40, 5)).toBe(20);
    expect(softnessBlur(40, -1)).toBe(0);
  });
  it('skips points that are too close', () => {
    const p = appendPoint(appendPoint([{ x: 0, y: 0 }], { x: 0.5, y: 0 }, 2), { x: 5, y: 0 }, 2);
    expect(p).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });
});

describe('view transform', () => {
  it('fits and centres an image in a box', () => {
    const t = fitTransform(200, 100, 100, 100);
    expect(t.scale).toBe(0.5);
    expect(imageToScreen(t, { x: 0, y: 0 })).toEqual({ x: 0, y: 25 });
    expect(fitTransform(0, 0, 10, 10)).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it('screen/image mapping round-trips', () => {
    const t = { scale: 2.5, x: 13, y: -7 };
    const p = { x: 40, y: 99 };
    const back = imageToScreen(t, screenToImage(t, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
  it('pinch zoom keeps the point under the fingers fixed', () => {
    const t = { scale: 1, x: 0, y: 0 };
    const prev = twoFinger({ x: 90, y: 100 }, { x: 110, y: 100 }); // centre (100,100), dist 20
    const next = twoFinger({ x: 80, y: 100 }, { x: 120, y: 100 }); // centre same, dist 40
    const t2 = applyPinch(t, prev, next, 0.1, 10);
    expect(t2.scale).toBe(2);
    const imgPt = screenToImage(t, { x: 100, y: 100 });
    const nowAt = imageToScreen(t2, imgPt);
    expect(nowAt.x).toBeCloseTo(100);
    expect(nowAt.y).toBeCloseTo(100);
  });
  it('two-finger drag pans', () => {
    const t = { scale: 2, x: 0, y: 0 };
    const prev = twoFinger({ x: 10, y: 10 }, { x: 30, y: 10 });
    const next = twoFinger({ x: 25, y: 20 }, { x: 45, y: 20 });
    const t2 = applyPinch(t, prev, next, 0.1, 10);
    expect(t2.scale).toBe(2);
    expect([t2.x, t2.y]).toEqual([15, 10]);
  });
  it('clamps zoom to the allowed range', () => {
    const t = { scale: 4, x: 0, y: 0 };
    const t2 = applyPinch(
      t,
      twoFinger({ x: 0, y: 0 }, { x: 10, y: 0 }),
      twoFinger({ x: 0, y: 0 }, { x: 1000, y: 0 }),
      0.5,
      5,
    );
    expect(t2.scale).toBe(5);
    const t3 = applyPinch(
      t,
      twoFinger({ x: 0, y: 0 }, { x: 1000, y: 0 }),
      twoFinger({ x: 0, y: 0 }, { x: 1, y: 0 }),
      0.5,
      5,
    );
    expect(t3.scale).toBe(0.5);
  });
  it('ignores a degenerate (zero-distance) previous pinch', () => {
    const t = { scale: 1, x: 0, y: 0 };
    const t2 = applyPinch(t, { cx: 0, cy: 0, dist: 0 }, { cx: 5, cy: 5, dist: 50 }, 0.5, 5);
    expect(t2.scale).toBe(1);
  });
  it('clampPan keeps part of the image on screen', () => {
    const c = clampPan({ scale: 1, x: -5000, y: 5000 }, 1000, 1000, 400, 400);
    expect(c.x).toBeGreaterThanOrEqual(400 - 1000 - 48);
    expect(c.y).toBeLessThanOrEqual(48);
  });
});
