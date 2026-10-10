/**
 * Synthetic fixtures for the cut-out tests. Everything is generated deterministically (no binary files, no
 * network). Each fixture returns the photo as RGBA, the *true* object mask, and `modelMask`: what a general
 * salient-object model typically returns for that scene (it keeps enclosed holes and anything touching the
 * object), which is what the clean-up tools have to repair.
 *
 * To add a real photo: drop it into `test/fixtures/real/` (see README.md there); tests that use it skip
 * themselves when the file is missing.
 */
export interface Fixture {
  name: string;
  width: number;
  height: number;
  /** RGBA, straight alpha, all 255 alpha. */
  rgba: Uint8Array;
  /** The mask a person would draw (0 or 255). */
  truth: Uint8Array;
  /** The mask a model would return (0 or 255, filled holes, attached blob). */
  modelMask: Uint8Array;
  /** Pixel colour of the removable background. */
  background: [number, number, number];
}

function blank(w: number, h: number, bg: [number, number, number]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([bg[0], bg[1], bg[2], 255], i * 4);
  return px;
}

const put = (px: Uint8Array, w: number, x: number, y: number, c: [number, number, number]) => {
  const i = (y * w + x) * 4;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
};

/** Tiny deterministic noise so edges are not perfectly clean (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A dark strap (rounded bar) with 7 round holes and a slot, lying on a light grey surface.
 * truth = bar minus holes. modelMask = the whole bar (holes filled in).
 */
export function objectWithHoles(w = 600, h = 300): Fixture {
  const bg: [number, number, number] = [196, 196, 196];
  const rgba = blank(w, h, bg);
  const truth = new Uint8Array(w * h);
  const modelMask = new Uint8Array(w * h);
  const r = rng(7);
  const bar = { x0: Math.round(w * 0.08), x1: Math.round(w * 0.92), y0: Math.round(h * 0.3), y1: Math.round(h * 0.7) };
  const holeR = Math.max(4, Math.round(h * 0.035));
  const holes = Array.from({ length: 7 }, (_, i) => ({
    cx: Math.round(w * 0.4 + i * w * 0.07),
    cy: Math.round(h * 0.5),
  }));
  const slot = { x0: Math.round(w * 0.12), x1: Math.round(w * 0.2), y0: Math.round(h * 0.46), y1: Math.round(h * 0.54) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBar = x >= bar.x0 && x < bar.x1 && y >= bar.y0 && y < bar.y1;
      if (!inBar) continue;
      modelMask[y * w + x] = 255;
      const inHole =
        holes.some((c) => Math.hypot(x - c.cx, y - c.cy) <= holeR) ||
        (x >= slot.x0 && x < slot.x1 && y >= slot.y0 && y < slot.y1);
      if (inHole) continue; // shows the grey surface through the strap
      truth[y * w + x] = 255;
      const n = Math.round(r() * 6);
      put(rgba, w, x, y, [24 + n, 26 + n, 30 + n]);
    }
  }
  return { name: 'object-with-holes', width: w, height: h, rgba, truth, modelMask, background: bg };
}

/**
 * A dark oval product with a bright round logo (blob) stuck to it through a narrow neck, like the logo
 * on a laptop lid under a watch. truth = oval only. modelMask = oval + neck + logo.
 */
export function objectWithBlob(w = 600, h = 400): Fixture {
  const bg: [number, number, number] = [120, 122, 128];
  const rgba = blank(w, h, bg);
  const truth = new Uint8Array(w * h);
  const modelMask = new Uint8Array(w * h);
  const ov = { cx: w * 0.4, cy: h * 0.5, rx: w * 0.26, ry: h * 0.3 };
  const logo = { cx: w * 0.82, cy: h * 0.5, r: Math.round(h * 0.13) };
  const neck = { x0: ov.cx + ov.rx - 2, x1: logo.cx - logo.r + 2, y0: Math.round(h * 0.5) - 3, y1: Math.round(h * 0.5) + 3 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inOval = ((x - ov.cx) / ov.rx) ** 2 + ((y - ov.cy) / ov.ry) ** 2 <= 1;
      const inLogo = Math.hypot(x - logo.cx, y - logo.cy) <= logo.r;
      const inNeck = x >= neck.x0 && x < neck.x1 && y >= neck.y0 && y < neck.y1;
      if (inOval) {
        truth[y * w + x] = 255;
        modelMask[y * w + x] = 255;
        put(rgba, w, x, y, [22, 24, 28]);
      } else if (inLogo || inNeck) {
        modelMask[y * w + x] = 255;
        put(rgba, w, x, y, inLogo ? [215, 218, 222] : [90, 92, 98]);
      }
    }
  }
  return { name: 'object-with-blob', width: w, height: h, rgba, truth, modelMask, background: bg };
}

/** A near-black product on a near-black scene: the low-contrast case a salient-object model struggles with. */
export function darkOnDark(w = 480, h = 320): Fixture {
  const bg: [number, number, number] = [34, 35, 38];
  const rgba = blank(w, h, bg);
  const truth = new Uint8Array(w * h);
  const r = rng(11);
  const box = { x0: Math.round(w * 0.2), x1: Math.round(w * 0.8), y0: Math.round(h * 0.2), y1: Math.round(h * 0.8) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = Math.round(r() * 3);
      if (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) {
        truth[y * w + x] = 255;
        put(rgba, w, x, y, [14 + n, 15 + n, 18 + n]);
      } else {
        put(rgba, w, x, y, [34 + n, 35 + n, 38 + n]);
      }
    }
  }
  // a model that struggles returns a ragged, slightly oversized mask
  const modelMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x >= box.x0 - 6 && x < box.x1 + 6 && y >= box.y0 - 6 && y < box.y1 + 6) modelMask[y * w + x] = 255;
  return { name: 'dark-on-dark', width: w, height: h, rgba, truth, modelMask, background: bg };
}

/**
 * A solid object with a 1 px wide "crown" sticking out of its right side. Used to prove that crops are
 * computed on the true mask, not a down-scaled probe (a 256 px probe loses a 1 px feature).
 */
export function objectWithThinFeature(w = 1600, h = 1000): Fixture {
  const bg: [number, number, number] = [240, 240, 240];
  const rgba = blank(w, h, bg);
  const truth = new Uint8Array(w * h);
  const body = { x0: Math.round(w * 0.3), x1: Math.round(w * 0.7), y0: Math.round(h * 0.3), y1: Math.round(h * 0.7) };
  for (let y = body.y0; y < body.y1; y++)
    for (let x = body.x0; x < body.x1; x++) {
      truth[y * w + x] = 255;
      put(rgba, w, x, y, [30, 30, 34]);
    }
  const crownY = Math.round(h * 0.5);
  for (let x = body.x1; x < w - 5; x++) {
    truth[crownY * w + x] = 255;
    put(rgba, w, x, crownY, [30, 30, 34]);
  }
  return { name: 'thin-feature', width: w, height: h, rgba, truth, modelMask: truth.slice(), background: bg };
}
