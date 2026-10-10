import { labDistance, labOf, meanLab } from './color';
import { components, dilate, erode, threshold } from './morph';

/**
 * Automatic clean-up suggestions for a freshly cut-out photo. These are HEURISTICS: nothing here changes the mask.
 * The editor highlights each suggestion and the user accepts or dismisses it one by one.
 * All analysis runs on a small working copy (<= ~1 MP); regions are returned in working-copy coordinates.
 */
export type SuggestionKind = 'hole' | 'speck' | 'blob' | 'pinhole';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  /** remove = take these pixels out of the cut-out; keep = put them back in. */
  action: 'remove' | 'keep';
  label: string;
  /** Pixels in the working copy. */
  area: number;
  /** Working-copy box [left, top, right, bottom) of the region. */
  bbox: [number, number, number, number];
  /** 0/255 mask of the region, size (right-left) x (bottom-top). */
  region: Uint8Array;
}

export interface AnalysisInput {
  rgba: Uint8Array;
  /** Model/edited mask, 0..255, same size as rgba. */
  alpha: Uint8Array;
  w: number;
  h: number;
}

export interface SuggestOptions {
  /** CIE76 distance within which an object pixel "looks like the old background". */
  holeColourTolerance: number;
  /** Detached pieces below this fraction of the object are specks. */
  speckFraction: number;
  /** Colour jump between a blob and the main object that marks the blob as foreign. */
  blobColourJump: number;
}

export const DEFAULT_SUGGEST: SuggestOptions = {
  holeColourTolerance: 14,
  speckFraction: 0.02,
  blobColourJump: 15,
};

/** Stable identity of a suggestion across re-analysis: its kind and where it is. */
export const keyOf = (kind: SuggestionKind, bb: [number, number, number, number]): string =>
  `${kind}:${bb.join(',')}`;

function crop(
  label: Int32Array,
  id: number,
  bb: [number, number, number, number],
  w: number,
): Uint8Array {
  const [l, t, r, b] = bb;
  const out = new Uint8Array((r - l) * (b - t));
  for (let y = t; y < b; y++)
    for (let x = l; x < r; x++) if (label[y * w + x] === id) out[(y - t) * (r - l) + (x - l)] = 255;
  return out;
}

/** Up to k colour centres of the given pixels (a few k-means rounds in Lab). */
function colourCentres(lab: Float32Array, idx: number[], k = 3): [number, number, number][] {
  if (idx.length === 0) return [];
  const centres: [number, number, number][] = [];
  const pick = (n: number) => idx[Math.floor((n * (idx.length - 1)) / Math.max(1, k - 1))]!;
  for (let c = 0; c < k; c++) {
    const i = pick(c);
    centres.push([lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!]);
  }
  for (let round = 0; round < 6; round++) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (const i of idx) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = labDistance(centres[c]!, [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const s = sum[best]!;
      s[0]! += lab[i * 3]!;
      s[1]! += lab[i * 3 + 1]!;
      s[2]! += lab[i * 3 + 2]!;
      s[3]!++;
    }
    for (let c = 0; c < centres.length; c++)
      if (sum[c]![3]! > 0)
        centres[c] = [
          sum[c]![0]! / sum[c]![3]!,
          sum[c]![1]! / sum[c]![3]!,
          sum[c]![2]! / sum[c]![3]!,
        ];
  }
  return centres;
}

/** Fraction of a region's outside 4-neighbours that satisfy `pred` (how "enclosed" the region is by that kind of pixel). */
function ringFraction(
  labels: Int32Array,
  id: number,
  bb: [number, number, number, number],
  w: number,
  h: number,
  pred: (i: number) => boolean,
): number {
  let total = 0;
  let hit = 0;
  const [l, t, r, b] = bb;
  for (let y = Math.max(0, t - 1); y < Math.min(h, b + 1); y++)
    for (let x = Math.max(0, l - 1); x < Math.min(w, r + 1); x++) {
      const i = y * w + x;
      if (labels[i] === id) continue;
      const touches =
        (x > 0 && labels[i - 1] === id) ||
        (x < w - 1 && labels[i + 1] === id) ||
        (y > 0 && labels[i - w] === id) ||
        (y < h - 1 && labels[i + w] === id);
      if (!touches) continue;
      total++;
      if (pred(i)) hit++;
    }
  return total === 0 ? 0 : hit / total;
}

export function suggestCleanups(
  input: AnalysisInput,
  opts: SuggestOptions = DEFAULT_SUGGEST,
): Suggestion[] {
  const { rgba, alpha, w, h } = input;
  const n = w * h;
  const lab = labOf(rgba, w, h);
  const bin = threshold(alpha, 127);
  const objComps = components(bin, w, h);
  if (objComps.count === 0) return [];
  let main = 1;
  for (let c = 2; c <= objComps.count; c++)
    if (objComps.areas[c]! > objComps.areas[main]!) main = c;
  const objArea = objComps.areas[main]!;
  const speckMax = Math.max(30, Math.round(opts.speckFraction * objArea));
  const out: Suggestion[] = [];
  const long = Math.max(w, h);

  // --- 1. detached specks / islands
  for (let c = 1; c <= objComps.count; c++) {
    if (c === main) continue;
    const a = objComps.areas[c]!;
    if (a > Math.max(speckMax, 0.25 * objArea)) continue;
    const bb = objComps.bboxes[c]!;
    out.push({
      id: keyOf('speck', bb),
      kind: 'speck',
      action: 'remove',
      label: a <= speckMax ? 'Small speck' : 'Detached piece',
      area: a,
      bbox: bb,
      region: crop(objComps.labels, c, bb, w),
    });
  }

  // --- 2. attached blobs: parts that survive an "opening" as separate pieces and hang on by a narrow neck
  const mainOnly = new Uint8Array(n);
  for (let i = 0; i < n; i++) mainOnly[i] = objComps.labels[i] === main ? 255 : 0;
  const r = Math.max(2, Math.round(0.012 * long));
  const core = dilate(erode(mainOnly, w, h, r), w, h, r);
  const coreComps = components(core, w, h);
  if (coreComps.count > 1) {
    let big = 1;
    for (let c = 2; c <= coreComps.count; c++)
      if (coreComps.areas[c]! > coreComps.areas[big]!) big = c;
    const mainCore = new Uint8Array(n);
    for (let i = 0; i < n; i++) mainCore[i] = coreComps.labels[i] === big ? 255 : 0;
    const mainRegion = dilate(mainCore, w, h, r + 1);
    const rest = new Uint8Array(n);
    for (let i = 0; i < n; i++) rest[i] = mainOnly[i] && !mainRegion[i] ? 255 : 0;
    const restComps = components(rest, w, h);
    const mainMean = meanLab(lab, erode(mainCore, w, h, r), n) ?? meanLab(lab, mainCore, n);
    for (let c = 1; c <= restComps.count; c++) {
      const a = restComps.areas[c]!;
      if (a < speckMax || a > 0.5 * objArea) continue;
      // must contain part of a separate core (a real blob), not just a sliver left by the dilation
      let hasCore = false;
      const flag = new Uint8Array(n);
      let alphaSum = 0;
      for (let i = 0; i < n; i++)
        if (restComps.labels[i] === c) {
          flag[i] = 1;
          alphaSum += alpha[i]!;
          if (coreComps.labels[i] && coreComps.labels[i] !== big) hasCore = true;
        }
      if (!hasCore) continue;
      const blobMean = meanLab(lab, flag, n);
      const colourJump = blobMean && mainMean ? labDistance(blobMean, mainMean) : 0;
      const lowConfidence = alphaSum / a < 200;
      if (colourJump < opts.blobColourJump && !lowConfidence) continue; // looks like part of the product
      const bb = restComps.bboxes[c]!;
      out.push({
        id: keyOf('blob', bb),
        kind: 'blob',
        action: 'remove',
        label:
          colourJump >= opts.blobColourJump
            ? 'Attached piece with a different colour'
            : 'Attached piece the model was unsure about',
        area: a,
        bbox: bb,
        region: crop(restComps.labels, c, bb, w),
      });
    }
  }

  // --- 3. holes: enclosed object pixels that still look like the old surrounding background (or that the model was unsure about)
  const outside = dilate(bin, w, h, 4);
  const bgIdx: number[] = [];
  const stride = Math.max(1, Math.floor(n / 20000));
  for (let i = 0; i < n; i += stride) if (!outside[i]) bgIdx.push(i);
  const centres = bgIdx.length >= 100 ? colourCentres(lab, bgIdx) : [];
  const objMean =
    meanLab(lab, erode(mainOnly, w, h, Math.max(1, r)), n) ?? meanLab(lab, mainOnly, n);
  const distinct = objMean ? centres.filter((c) => labDistance(c, objMean) > 18) : [];
  {
    const cand = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!bin[i]) continue;
      const px: [number, number, number] = [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!];
      const bgLike = distinct.some((c) => labDistance(c, px) <= opts.holeColourTolerance);
      const unsure = alpha[i]! < 200;
      if (bgLike || unsure) cand[i] = 255;
    }
    const cc = components(cand, w, h);
    const minHole = Math.max(8, Math.round(1e-4 * n));
    for (let c = 1; c <= cc.count; c++) {
      const a = cc.areas[c]!;
      if (a < minHole || a > 0.3 * objArea) continue;
      const bb = cc.bboxes[c]!;
      // enclosed: surrounded by object pixels that are neither background-like nor unsure
      const enclosed = ringFraction(cc.labels, c, bb, w, h, (i) => bin[i] === 255 && !cand[i]);
      if (enclosed < 0.85) continue;
      out.push({
        id: keyOf('hole', bb),
        kind: 'hole',
        action: 'remove',
        label: 'Opening that still shows the old background',
        area: a,
        bbox: bb,
        region: crop(cc.labels, c, bb, w),
      });
    }
  }

  // --- 4. pin-holes: tiny transparent specks inside solid areas
  const clear = new Uint8Array(n);
  for (let i = 0; i < n; i++) clear[i] = bin[i] ? 0 : 255;
  const hc = components(clear, w, h);
  const maxPin = Math.max(6, Math.round(0.0015 * objArea));
  for (let c = 1; c <= hc.count; c++) {
    if (hc.touchesBorder[c]) continue;
    const a = hc.areas[c]!;
    if (a > maxPin) continue;
    const bb = hc.bboxes[c]!;
    if (ringFraction(hc.labels, c, bb, w, h, (i) => bin[i] === 255) < 0.95) continue;
    out.push({
      id: keyOf('pinhole', bb),
      kind: 'pinhole',
      action: 'keep',
      label: 'Tiny hole inside a solid area',
      area: a,
      bbox: bb,
      region: crop(hc.labels, c, bb, w),
    });
  }
  return out;
}
