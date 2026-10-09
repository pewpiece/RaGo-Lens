import { ellipseMask, MockEngine } from '@/engine/mockEngine';
import {
  applyMaskToRgba,
  boxBlur,
  maskBounds,
  postprocessMask,
  resizeMaskBilinear,
  scaleAndPadBounds,
  smoothstep,
} from '@/engine/postprocess';
import { MODEL_INPUT_SIZE, rgbaToNchw } from '@/engine/preprocess';
import { CutoutError, isCancelled, toCutoutError } from '@/engine/types';

describe('rgbaToNchw', () => {
  it('lays out planes as CHW and normalises with max-division, mean and std', () => {
    // 2x1 image: pixel0 = (255,0,0), pixel1 = (0,255,0)
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const t = rgbaToNchw(rgba, 2, 1);
    expect(t).toHaveLength(6);
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5); // R plane, px0
    expect(t[1]).toBeCloseTo((0 - 0.485) / 0.229, 5); // R plane, px1
    expect(t[2]).toBeCloseTo((0 - 0.456) / 0.224, 5); // G plane, px0
    expect(t[3]).toBeCloseTo((1 - 0.456) / 0.224, 5); // G plane, px1
    expect(t[4]).toBeCloseTo((0 - 0.406) / 0.225, 5); // B plane
  });
  it('divides by the image max, so a dim image is stretched', () => {
    const t = rgbaToNchw(new Uint8Array([100, 100, 100, 255]), 1, 1);
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
  });
  it('does not produce NaN for an all-black image', () => {
    const t = rgbaToNchw(new Uint8Array(4 * 4), 2, 2);
    expect(Array.from(t).every(Number.isFinite)).toBe(true);
  });
  it('rejects undersized buffers', () => {
    expect(() => rgbaToNchw(new Uint8Array(3), 1, 1)).toThrow();
  });
  it('exposes the model input size', () => expect(MODEL_INPUT_SIZE).toBe(320));
});

describe('postprocessMask', () => {
  it('min-max normalises, so any value range maps to the full 0..255', () => {
    const r = postprocessMask([0.2, 0.2, 0.9, 0.9], 2, 2, { blurRadius: 0 });
    expect(Array.from(r.alpha)).toEqual([0, 0, 255, 255]);
  });
  it('keeps soft edges between the thresholds (not a hard binary mask)', () => {
    const r = postprocessMask([0, 0.5, 1], 3, 1, { blurRadius: 0 });
    expect(r.alpha[0]).toBe(0);
    expect(r.alpha[1]).toBeGreaterThan(100);
    expect(r.alpha[1]).toBeLessThan(155);
    expect(r.alpha[2]).toBe(255);
  });
  it('treats a flat output as "nothing found"', () => {
    const r = postprocessMask(new Float32Array(9).fill(0.7), 3, 3);
    expect(Array.from(r.alpha).every((v) => v === 0)).toBe(true);
  });
  it('blur smooths a hard step', () => {
    const r = postprocessMask([0, 0, 0, 1, 1, 1], 6, 1, { blurRadius: 1, low: 0.4, high: 0.6 });
    expect(r.alpha[2]).toBeGreaterThan(0);
    expect(r.alpha[3]).toBeLessThan(255);
  });
  it('rejects too-small output', () => {
    expect(() => postprocessMask([1], 2, 2)).toThrow();
  });
  it('smoothstep clamps', () => {
    expect(smoothstep(0.2, 0.8, -1)).toBe(0);
    expect(smoothstep(0.2, 0.8, 2)).toBe(1);
    expect(smoothstep(0.2, 0.8, 0.5)).toBeCloseTo(0.5);
  });
  it('boxBlur preserves a constant field', () => {
    const out = boxBlur(new Float32Array(25).fill(0.5), 5, 5, 2);
    expect(Array.from(out).every((v) => Math.abs(v - 0.5) < 1e-6)).toBe(true);
  });
});

describe('applyMaskToRgba (known mask -> known alpha)', () => {
  it('writes mask*alpha into the alpha channel and leaves colour alone', () => {
    const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 128, 1, 2, 3, 255]);
    const mask = new Uint8Array([0, 255, 255, 128]);
    const out = applyMaskToRgba(rgba, mask);
    expect(Array.from(out)).toEqual([
      10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128, 1, 2, 3, 128,
    ]);
    expect(rgba[3]).toBe(255); // input not mutated
  });
  it('throws on a size mismatch', () => {
    expect(() => applyMaskToRgba(new Uint8Array(8), new Uint8Array(3))).toThrow();
  });
});

describe('resizeMaskBilinear', () => {
  it('upscales a 2x2 mask smoothly and keeps corners', () => {
    const out = resizeMaskBilinear(new Uint8Array([0, 255, 0, 255]), 2, 2, 4, 4);
    expect(out[0]).toBe(0);
    expect(out[3]).toBe(255);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[1]).toBeLessThan(255);
  });
  it('is the identity at the same size', () => {
    const src = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(Array.from(resizeMaskBilinear(src, 3, 2, 3, 2))).toEqual(Array.from(src));
  });
});

describe('maskBounds / scaleAndPadBounds', () => {
  const alpha = new Uint8Array(10 * 8);
  alpha[2 * 10 + 3] = 255;
  alpha[5 * 10 + 6] = 200;
  it('finds the tight box (right/bottom exclusive)', () => {
    expect(maskBounds(alpha, 10, 8)).toEqual({ left: 3, top: 2, right: 7, bottom: 6 });
  });
  it('returns null for an empty mask', () => {
    expect(maskBounds(new Uint8Array(12), 4, 3)).toBeNull();
  });
  it('ignores faint noise below the threshold', () => {
    const a = new Uint8Array(16);
    a[0] = 10;
    expect(maskBounds(a, 4, 4)).toBeNull();
  });
  it('scales, pads and clamps', () => {
    const b = scaleAndPadBounds({ left: 3, top: 2, right: 7, bottom: 6 }, 10, 10, 10, 100, 80);
    expect(b).toEqual({ left: 26, top: 16, right: 74, bottom: 64 });
    expect(
      scaleAndPadBounds({ left: 0, top: 0, right: 10, bottom: 8 }, 10, 10, 50, 100, 80),
    ).toEqual({
      left: 0,
      top: 0,
      right: 100,
      bottom: 80,
    });
  });
});

describe('MockEngine', () => {
  it('returns a centred ellipse with the same aspect ratio', async () => {
    const m = await new MockEngine({ maskSize: 64 }).segment({ uri: 'x', width: 400, height: 200 });
    expect([m.width, m.height]).toEqual([64, 32]);
    expect(m.alpha[Math.floor(m.height / 2) * m.width + Math.floor(m.width / 2)]).toBe(255);
    expect(m.alpha[0]).toBe(0);
  });
  it('reports progress', async () => {
    const seen: number[] = [];
    await new MockEngine().segment(
      { uri: 'x', width: 10, height: 10 },
      { onProgress: (f) => seen.push(f) },
    );
    expect(seen[seen.length - 1]).toBe(1);
  });
  it('can be cancelled before and during work', async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      new MockEngine().segment({ uri: 'x', width: 4, height: 4 }, { signal: c.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    const c2 = new AbortController();
    const p = new MockEngine({ delayMs: 50 }).segment(
      { uri: 'x', width: 4, height: 4 },
      { signal: c2.signal },
    );
    setTimeout(() => c2.abort(), 5);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('isCancelled recognises cancellation errors', () => {
    expect(isCancelled(new CutoutError('cancelled', 'x'))).toBe(true);
    expect(isCancelled(new Error('x'))).toBe(false);
  });
  it('surfaces injected failures', async () => {
    await expect(
      new MockEngine({ failWith: new Error('boom') }).segment({ uri: 'x', width: 4, height: 4 }),
    ).rejects.toThrow('boom');
  });
  it('ellipseMask is symmetric', () => {
    const m = ellipseMask(9, 9);
    expect(m.alpha[4 * 9 + 2]).toBe(m.alpha[4 * 9 + 6]);
  });
});

describe('toCutoutError', () => {
  it('classifies memory, decode and unknown failures', () => {
    expect(toCutoutError(new Error('java.lang.OutOfMemoryError')).code).toBe('out-of-memory');
    expect(toCutoutError(new Error('Could not load image')).code).toBe('unreadable-image');
    expect(toCutoutError(new Error('weird')).code).toBe('inference-failed');
    const e = new CutoutError('model-missing', 'x');
    expect(toCutoutError(e)).toBe(e);
  });
});
