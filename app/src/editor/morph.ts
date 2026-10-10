/** Small-image morphology and connected components for the clean-up and selection analysis (run on a <= ~1 MP copy). */
export interface Components {
  /** 0 = not in the set, 1..count = component id. */
  labels: Int32Array;
  count: number;
  /** areas[id], bboxes[id] = [left, top, right(excl), bottom(excl)]. Index 0 unused. */
  areas: number[];
  bboxes: [number, number, number, number][];
  /** True when the component touches the image border. */
  touchesBorder: boolean[];
}

/** 4-connected components of the pixels where `set[i] !== 0`. */
export function components(set: Uint8Array, w: number, h: number): Components {
  const labels = new Int32Array(w * h);
  const areas: number[] = [0];
  const bboxes: [number, number, number, number][] = [[0, 0, 0, 0]];
  const touchesBorder: boolean[] = [false];
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (!set[s] || labels[s]) continue;
    count++;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = count;
    let area = 0;
    let l = w;
    let t = h;
    let r = -1;
    let b = -1;
    let border = false;
    while (sp > 0) {
      const p = stack[--sp]!;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && set[p - 1] && !labels[p - 1]) {
        labels[p - 1] = count;
        stack[sp++] = p - 1;
      }
      if (x < w - 1 && set[p + 1] && !labels[p + 1]) {
        labels[p + 1] = count;
        stack[sp++] = p + 1;
      }
      if (y > 0 && set[p - w] && !labels[p - w]) {
        labels[p - w] = count;
        stack[sp++] = p - w;
      }
      if (y < h - 1 && set[p + w] && !labels[p + w]) {
        labels[p + w] = count;
        stack[sp++] = p + w;
      }
    }
    areas.push(area);
    bboxes.push([l, t, r + 1, b + 1]);
    touchesBorder.push(border);
  }
  return { labels, count, areas, bboxes, touchesBorder };
}

/** Square-structuring-element dilation (max filter) of a 0/255 image, radius r px. */
export function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return rank(src, w, h, r, true);
}
/** Square-structuring-element erosion (min filter) of a 0/255 image, radius r px. */
export function erode(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return rank(src, w, h, r, false);
}

function rank(src: Uint8Array, w: number, h: number, r: number, max: boolean): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  // horizontal: sliding count of "extreme" pixels in the window, O(n) per pass
  const hit = max ? (v: number) => v > 127 : (v: number) => v <= 127;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let cnt = 0;
    for (let x = 0; x < Math.min(w, r); x++) if (hit(src[row + x]!)) cnt++;
    for (let x = 0; x < w; x++) {
      const add = x + r;
      if (add < w && hit(src[row + add]!)) cnt++;
      const rem = x - r - 1;
      if (rem >= 0 && hit(src[row + rem]!)) cnt--;
      tmp[row + x] = max ? (cnt > 0 ? 255 : 0) : cnt > 0 ? 0 : 255;
    }
  }
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let y = 0; y < Math.min(h, r); y++) if (hit(tmp[y * w + x]!)) cnt++;
    for (let y = 0; y < h; y++) {
      const add = y + r;
      if (add < h && hit(tmp[add * w + x]!)) cnt++;
      const rem = y - r - 1;
      if (rem >= 0 && hit(tmp[rem * w + x]!)) cnt--;
      out[y * w + x] = max ? (cnt > 0 ? 255 : 0) : cnt > 0 ? 0 : 255;
    }
  }
  return out;
}

/** Binary threshold to 0/255. */
export function threshold(src: Uint8Array, t = 127): Uint8Array {
  const o = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) o[i] = src[i]! > t ? 255 : 0;
  return o;
}

/**
 * Grey-scale max (dilate) or min (erode) filter with a square window of radius r, separable, edges clamped.
 * Used for "shift edge" and selection grow/shrink. Measured in CanvasKit on a 584 x 584 region: Skia's morphology image
 * filter takes 1.2 s at radius 2 and 3.9 s at radius 8 on the CPU raster path; this takes a few milliseconds, so the
 * (tile-sized) region is processed here instead.
 */
export function grayRank(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
  max: boolean,
): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const pick = max
    ? (a: number, b: number) => (b > a ? b : a)
    : (a: number, b: number) => (b < a ? b : a);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = x - r < 0 ? 0 : x - r;
      const b = x + r > w - 1 ? w - 1 : x + r;
      let m = src[row + a]!;
      for (let k = a + 1; k <= b; k++) m = pick(m, src[row + k]!);
      tmp[row + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    const a = y - r < 0 ? 0 : y - r;
    const b = y + r > h - 1 ? h - 1 : y + r;
    for (let x = 0; x < w; x++) {
      let m = tmp[a * w + x]!;
      for (let k = a + 1; k <= b; k++) m = pick(m, tmp[k * w + x]!);
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Three box-blur sizes whose combination approximates a Gaussian of the given sigma (the classic "box blur" estimate). */
function boxSizes(sigma: number): number[] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  // horizontal into dst, vertical back into src (so the caller always finds the result in `src`)
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const first = src[row]!;
    const last = src[row + w - 1]!;
    let acc = first * r;
    for (let k = 0; k <= r; k++) acc += k < w ? src[row + k]! : last;
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * inv;
      const add = x + r + 1 < w ? src[row + x + r + 1]! : last;
      const sub = x - r >= 0 ? src[row + x - r]! : first;
      acc += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    const first = dst[x]!;
    const last = dst[(h - 1) * w + x]!;
    let acc = first * r;
    for (let k = 0; k <= r; k++) acc += k < h ? dst[k * w + x]! : last;
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc * inv;
      const add = y + r + 1 < h ? dst[(y + r + 1) * w + x]! : last;
      const sub = y - r >= 0 ? dst[(y - r) * w + x]! : first;
      acc += add - sub;
    }
  }
}

/** Gaussian-like blur (three box passes, O(n) each) of an 8-bit region. Edges clamped. */
export function gaussBlur(src: Uint8Array, w: number, h: number, sigma: number): Uint8Array {
  if (sigma <= 0.3) return src.slice();
  const a = new Float32Array(src.length);
  for (let i = 0; i < a.length; i++) a[i] = src[i]!;
  const b = new Float32Array(a.length);
  for (const size of boxSizes(sigma)) boxPass(a, b, w, h, (size - 1) / 2);
  const out = new Uint8Array(a.length);
  for (let i = 0; i < out.length; i++) {
    const v = a[i]! + 0.5;
    out[i] = v >= 255 ? 255 : v <= 0 ? 0 : v | 0;
  }
  return out;
}

/** alpha' = clamp((alpha - lo) / (hi - lo)) with lo, hi in 0..1: re-thresholds a blurred mask into a clean contour. */
export function rampAlpha(src: Uint8Array, lo: number, hi: number): Uint8Array {
  const k = 1 / Math.max(0.01, hi - lo);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++)
    lut[v] = Math.round(Math.min(1, Math.max(0, (v / 255 - lo) * k)) * 255);
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = lut[src[i]!]!;
  return out;
}
