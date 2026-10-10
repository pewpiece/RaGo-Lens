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
