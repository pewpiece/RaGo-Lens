/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { fitTransform } from '@/scene/viewTransform';
import {
  MAX_ZOOM,
  actualScale,
  isZoomedIn,
  miniMapRect,
  toggleFitActual,
  viewFromMiniMap,
  zoomLimits,
} from '@/editor/viewport';
import { pickLevel } from '@/editor/pyramid';
import { averageProductLuma, checkerFor } from '@/editor/viewModes';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

describe('zoom and pan helpers', () => {
  const img = { w: 4000, h: 3000 };
  const box = { w: 400, h: 600 };
  it('allows at least 1600 % and never less than fit', () => {
    const fit = fitTransform(img.w, img.h, box.w, box.h);
    const { min, max } = zoomLimits(fit.scale);
    expect(min).toBe(fit.scale);
    expect(max).toBeGreaterThanOrEqual(MAX_ZOOM);
  });
  it('double tap zooms to 100 % around the tap, and back to fit', () => {
    const fit = fitTransform(img.w, img.h, box.w, box.h);
    const tap = { x: 300, y: 300 };
    const z = toggleFitActual(fit, img.w, img.h, box.w, box.h, tap, 3);
    expect(z.scale).toBeCloseTo(actualScale(3), 5);
    // the photo point under the finger stays under the finger (when clampPan did not have to move it)
    const before = { x: (tap.x - fit.x) / fit.scale, y: (tap.y - fit.y) / fit.scale };
    const after = { x: (tap.x - z.x) / z.scale, y: (tap.y - z.y) / z.scale };
    expect(Math.abs(after.x - before.x)).toBeLessThan(60);
    const back = toggleFitActual(z, img.w, img.h, box.w, box.h, tap, 3);
    expect(back).toEqual(fit);
  });
  it('mini-map shows the visible window and tapping it recentres', () => {
    const fit = fitTransform(img.w, img.h, box.w, box.h);
    expect(isZoomedIn(fit, img.w, img.h, box.w, box.h)).toBe(false);
    const full = miniMapRect(fit, box.w, box.h, img.w, img.h, 100, 75);
    expect(full.x).toBeCloseTo(0, 5);
    expect(full.w).toBeCloseTo(100, 5);
    const zoomed = { scale: fit.scale * 4, x: -200, y: -100 };
    expect(isZoomedIn(zoomed, img.w, img.h, box.w, box.h)).toBe(true);
    const r = miniMapRect(zoomed, box.w, box.h, img.w, img.h, 100, 75);
    expect(r.w).toBeLessThan(40);
    const v = viewFromMiniMap(90, 60, zoomed, box.w, box.h, img.w, img.h, 100, 75);
    const centre = { x: (box.w / 2 - v.x) / v.scale, y: (box.h / 2 - v.y) / v.scale };
    expect(centre.x).toBeGreaterThan(img.w * 0.7);
    expect(centre.y).toBeGreaterThan(img.h * 0.6);
  });
});

describe('image pyramid level choice', () => {
  it('uses full resolution when zoomed in and smaller levels when zoomed out', () => {
    expect(pickLevel(1, 6)).toBe(0);
    expect(pickLevel(2, 6)).toBe(0);
    expect(pickLevel(0.5, 6)).toBe(1);
    expect(pickLevel(0.1, 6)).toBe(3);
    expect(pickLevel(0.0001, 3)).toBe(2); // never past the last level
  });
});

describe('view mode defaults', () => {
  it('shows a dark product on the light checkerboard and a light product on the dark one', () => {
    const dark = new Uint8Array([10, 10, 12, 255, 12, 12, 14, 255]);
    const light = new Uint8Array([240, 240, 240, 255, 250, 250, 250, 255]);
    const a = new Uint8Array([255, 255]);
    expect(checkerFor(averageProductLuma(dark, a))).toBe('checker-light');
    expect(checkerFor(averageProductLuma(light, a))).toBe('checker-dark');
    expect(averageProductLuma(dark, new Uint8Array([0, 0]))).toBe(0.5);
  });
});
