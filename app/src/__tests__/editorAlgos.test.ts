import { labOf } from '@/editor/color';
import { magicWand } from '@/editor/wand';
import { components, dilate, erode } from '@/editor/morph';
import { refineMatte } from '@/editor/matting';
import { objectWithBlob } from '../../test/fixtures';

const lab = (f: { rgba: Uint8Array; width: number; height: number }) =>
  labOf(f.rgba, f.width, f.height);

describe('morphology', () => {
  it('labels 4-connected components with areas, boxes and border contact', () => {
    const w = 10;
    const h = 6;
    const s = new Uint8Array(w * h);
    for (let y = 1; y < 3; y++) for (let x = 1; x < 4; x++) s[y * w + x] = 1; // 6 px
    s[5 * w + 9] = 1; // corner pixel, border
    s[2 * w + 6] = 1;
    s[3 * w + 7] = 1; // diagonal: NOT connected in 4-connectivity
    const c = components(s, w, h);
    expect(c.count).toBe(4);
    expect(c.areas.slice(1).sort((a, b) => b - a)).toEqual([6, 1, 1, 1]);
    expect(c.touchesBorder.filter(Boolean)).toHaveLength(1);
  });
  it('erode then dilate removes thin necks but keeps big bodies', () => {
    const w = 40;
    const h = 20;
    const s = new Uint8Array(w * h);
    for (let y = 4; y < 16; y++) for (let x = 2; x < 14; x++) s[y * w + x] = 255; // body
    for (let y = 4; y < 16; y++) for (let x = 26; x < 38; x++) s[y * w + x] = 255; // blob
    for (let y = 9; y < 11; y++) for (let x = 14; x < 26; x++) s[y * w + x] = 255; // 2 px neck
    expect(components(s, w, h).count).toBe(1);
    const opened = dilate(erode(s, w, h, 2), w, h, 2);
    expect(components(opened, w, h).count).toBe(2);
    expect(opened[10 * w + 8]).toBe(255);
  });
});

describe('magic wand (Lab flood fill)', () => {
  it('one tap on the attached logo selects the logo and nothing of the product', () => {
    const f = objectWithBlob();
    const l = lab(f);
    const logoPx = { x: Math.round(f.width * 0.82), y: Math.round(f.height * 0.5) };
    const sel = magicWand(l, f.width, f.height, logoPx, {
      tolerance: 20,
      contiguous: true,
      edgeAware: true,
      edgeSensitivity: 0.5,
    });
    const inLogo = (i: number) => f.modelMask[i] === 255 && f.truth[i] === 0;
    let hit = 0,
      logoTotal = 0,
      leak = 0;
    for (let i = 0; i < sel.length; i++) {
      if (f.rgba[i * 4] === 215 && f.rgba[i * 4 + 1] === 218) logoTotal++;
      if (sel[i] && inLogo(i) && f.rgba[i * 4] === 215) hit++;
      if (sel[i] && f.truth[i] === 255) leak++;
    }
    expect(hit / logoTotal).toBeGreaterThan(0.98);
    expect(leak).toBe(0);
  });

  it('a larger tolerance leaks across a soft step, edge-awareness stops it', () => {
    const w = 60;
    const h = 20;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = x < 30 ? 120 : 138; // a step of ~7 Lab units
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    const l = labOf(rgba, w, h);
    const base = { tolerance: 25, contiguous: true, edgeSensitivity: 0.9 };
    const leaky = magicWand(l, w, h, { x: 5, y: 5 }, { ...base, edgeAware: false });
    const stopped = magicWand(l, w, h, { x: 5, y: 5 }, { ...base, edgeAware: true });
    expect(leaky[5 * w + 50]).toBe(255);
    expect(stopped[5 * w + 50]).toBe(0);
    expect(stopped[5 * w + 10]).toBe(255);
  });

  it('non-contiguous mode selects every similar region; restrictTo confines to the cutout', () => {
    const w = 30;
    const h = 10;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        rgba.set(x >= 10 && x < 15 ? [200, 0, 0, 255] : [20, 20, 20, 255], (y * w + x) * 4);
    for (let y = 0; y < h; y++)
      for (let x = 22; x < 27; x++) rgba.set([200, 0, 0, 255], (y * w + x) * 4);
    const l = labOf(rgba, w, h);
    const o = { tolerance: 10, contiguous: false, edgeAware: false, edgeSensitivity: 0.5 };
    const all = magicWand(l, w, h, { x: 12, y: 5 }, o);
    expect(all[5 * w + 24]).toBe(255);
    const only = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 18; x++) only[y * w + x] = 255;
    expect(magicWand(l, w, h, { x: 12, y: 5 }, { ...o, restrictTo: only })[5 * w + 24]).toBe(0);
    expect(magicWand(l, w, h, { x: 25, y: 5 }, { ...o, restrictTo: only }).some((v) => v)).toBe(
      false,
    );
  });

  it('is fast enough on a 1 MP working copy (measured, printed)', () => {
    const w = 1024;
    const h = 1024;
    const rgba = new Uint8Array(w * h * 4).fill(90);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    const l = labOf(rgba, w, h);
    const t0 = Date.now();
    const sel = magicWand(
      l,
      w,
      h,
      { x: 500, y: 500 },
      { tolerance: 20, contiguous: true, edgeAware: true, edgeSensitivity: 0.5 },
    );
    const ms = Date.now() - t0;
    console.log(
      `wand on 1024x1024 (whole image selected): ${ms} ms in Node/V8 (not a phone number)`,
    );
    expect(sel[0]).toBe(255);
    expect(ms).toBeLessThan(2000);
  });
});

describe('matting: edge refinement and decontamination', () => {
  // red square on green with an anti-aliased edge; the "model" mask is a blurry, 3 px oversized version
  const W = 120;
  const H = 120;
  const mk = () => {
    const rgba = new Uint8Array(W * H * 4);
    const truthA = new Float32Array(W * H);
    const init = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // coverage of the true edge at x = 40.5 (half-covered pixel at column 40), same on y
        const cx = Math.min(
          1,
          Math.max(0, x < 40 ? 0 : x === 40 ? 0.5 : x < 80 ? 1 : x === 80 ? 0.5 : 0),
        );
        const cy = Math.min(
          1,
          Math.max(0, y < 40 ? 0 : y === 40 ? 0.5 : y < 80 ? 1 : y === 80 ? 0.5 : 0),
        );
        const a = cx * cy;
        truthA[y * W + x] = a;
        const r = Math.round(a * 220 + (1 - a) * 20);
        const g = Math.round(a * 20 + (1 - a) * 200);
        const b = Math.round(a * 20 + (1 - a) * 30);
        rgba.set([r, g, b, 255], (y * W + x) * 4);
        // model mask: object grown by ~3 px with a soft 5 px ramp
        const dx = Math.max(37 - x, x - 83, 0);
        const dy = Math.max(37 - y, y - 83, 0);
        const d = Math.hypot(dx, dy);
        init[y * W + x] = Math.round(255 * Math.min(1, Math.max(0, 1 - d / 5)));
      }
    return { rgba, truthA, init };
  };

  it('snaps a blurry, oversized mask to the real edge', () => {
    const { rgba, truthA, init } = mk();
    const m = refineMatte(rgba, init, W, H, { bandRadius: 6 });
    let before = 0,
      after = 0,
      n = 0;
    for (let i = 0; i < W * H; i++) {
      if (!m.band[i]) continue;
      before += Math.abs(init[i]! / 255 - truthA[i]!);
      after += Math.abs(m.alpha[i]! / 255 - truthA[i]!);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(after / n).toBeLessThan((before / n) * 0.4);
  });

  it('decontamination removes the green halo from edge colours (measured)', () => {
    const { rgba, init } = mk();
    const m = refineMatte(rgba, init, W, H, { bandRadius: 6 });
    // "green contamination" of semi-transparent edge pixels: green minus the blue-ish foreground level (20) of the red square
    let rawG = 0,
      cleanG = 0,
      count = 0;
    for (let i = 0; i < W * H; i++) {
      const a = m.alpha[i]! / 255;
      if (!m.band[i] || a < 0.2 || a > 0.95) continue;
      rawG += rgba[i * 4 + 1]! - 20;
      cleanG += m.colour[i * 3 + 1]! - 20;
      count++;
    }
    expect(count).toBeGreaterThan(20);
    const raw = rawG / count;
    const clean = cleanG / count;
    console.log(
      `edge green excess: before ${raw.toFixed(1)}, after ${clean.toFixed(1)} (255 scale)`,
    );
    expect(clean).toBeLessThan(raw * 0.5);
  });

  it('keeps the model alpha when foreground and background look the same (dark on dark)', () => {
    const w = 40;
    const h = 40;
    const rgba = new Uint8Array(w * h * 4);
    const init = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      rgba.set([30, 30, 32, 255], i * 4);
      const x = i % w;
      init[i] = x < 18 ? 0 : x > 22 ? 255 : (x - 18) * 63;
    }
    const m = refineMatte(rgba, init, w, h, { bandRadius: 3 });
    let diff = 0;
    for (let i = 0; i < w * h; i++) diff = Math.max(diff, Math.abs(m.alpha[i]! - init[i]!));
    expect(diff).toBeLessThanOrEqual(64); // smoothed a little, never replaced by noise
  });
});
