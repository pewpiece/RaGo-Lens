import type { OcrFrame } from './types';

/** A recognised line with the block it came from (used to keep paragraph hints). */
export interface FlatLine {
  text: string;
  frame?: OcrFrame;
  blockId: number;
}

export interface OrderedLine extends FlatLine {
  /** True when this line starts a new column/band, so the vertical jump from the previous line is not a paragraph gap. */
  sectionStart: boolean;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const right = (f: OcrFrame) => f.left + f.width;
const bottom = (f: OcrFrame) => f.top + f.height;
const centreY = (f: OcrFrame) => f.top + f.height / 2;

export interface Gutter {
  /** x range with no (narrow) text crossing it */
  start: number;
  end: number;
}

/**
 * Finds a vertical gap between two text columns, or null for single-column pages.
 * Lines wider than 60 % of the text width (titles, ruled rows) are ignored: they span both columns.
 */
export function findGutter(lines: { frame: OcrFrame }[]): Gutter | null {
  if (lines.length < 6) return null;
  const pageLeft = Math.min(...lines.map((l) => l.frame.left));
  const pageRight = Math.max(...lines.map((l) => right(l.frame)));
  const W = pageRight - pageLeft;
  if (W <= 0) return null;
  const H = median(lines.map((l) => l.frame.height)) || 1;
  const narrow = lines.filter((l) => l.frame.width < 0.6 * W);
  if (narrow.length < 6) return null;

  // merge the horizontal extents of narrow lines
  const spans = narrow
    .map((l) => [l.frame.left, right(l.frame)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  // widest uncovered gap in the middle 60 % of the page
  let best: Gutter | null = null;
  for (let i = 0; i + 1 < merged.length; i++) {
    const gap: Gutter = { start: merged[i]![1], end: merged[i + 1]![0] };
    const mid = (gap.start + gap.end) / 2;
    if (mid < pageLeft + 0.2 * W || mid > pageRight - 0.2 * W) continue;
    if (gap.end - gap.start < Math.max(0.8 * H, 0.015 * W)) continue;
    if (!best || gap.end - gap.start > best.end - best.start) best = gap;
  }
  if (!best) return null;
  const centre = (best.start + best.end) / 2;
  const leftCount = narrow.filter((l) => centreX(l.frame) < centre).length;
  const rightCount = narrow.length - leftCount;
  // both sides must look like real columns
  if (leftCount < 3 || rightCount < 3) return null;
  return best;
}

const centreX = (f: OcrFrame) => f.left + f.width / 2;

/**
 * Reading order for pages with two columns: each column top to bottom, left then right, with full-width lines
 * (titles) acting as separators. Pages without a gutter keep the recogniser's own order.
 */
export function readingOrder(lines: FlatLine[]): OrderedLine[] {
  if (lines.length === 0) return [];
  if (lines.some((l) => !l.frame)) return lines.map((l, i) => ({ ...l, sectionStart: i === 0 }));
  const framed = lines as (FlatLine & { frame: OcrFrame })[];
  const gutter = findGutter(framed);
  if (!gutter) return lines.map((l, i) => ({ ...l, sectionStart: i === 0 }));

  const centre = (gutter.start + gutter.end) / 2;
  const kind = (l: { frame: OcrFrame }): 'full' | 'left' | 'right' =>
    l.frame.left < gutter.start && right(l.frame) > gutter.end
      ? 'full'
      : centreX(l.frame) < centre
        ? 'left'
        : 'right';

  const byTop = [...framed].sort(
    (a, b) => a.frame.top - b.frame.top || a.frame.left - b.frame.left,
  );
  const out: OrderedLine[] = [];
  let leftCol: typeof framed = [];
  let rightCol: typeof framed = [];
  const flush = () => {
    for (const col of [leftCol, rightCol]) {
      col.forEach((l, i) => out.push({ ...l, sectionStart: i === 0 }));
    }
    leftCol = [];
    rightCol = [];
  };
  for (const l of byTop) {
    const k = kind(l);
    if (k === 'full') {
      flush();
      out.push({ ...l, sectionStart: true });
    } else if (k === 'left') leftCol.push(l);
    else rightCol.push(l);
  }
  flush();
  if (out.length) out[0]!.sectionStart = true;
  return out;
}

/**
 * Joins lines that sit on the same visual row (e.g. "6 (a-b)" and "= a^3 - ..." recognised separately)
 * into one line, left to right. Only neighbours in the given order are merged.
 */
export function mergeRows(lines: OrderedLine[]): OrderedLine[] {
  const out: OrderedLine[] = [];
  let group: OrderedLine[] = [];
  const emit = () => {
    if (group.length === 0) return;
    if (group.length === 1) {
      out.push(group[0]!);
    } else {
      const sorted = [...group].sort((a, b) => a.frame!.left - b.frame!.left);
      const fs = sorted.map((g) => g.frame!);
      const left = Math.min(...fs.map((f) => f.left));
      const top = Math.min(...fs.map((f) => f.top));
      const r = Math.max(...fs.map(right));
      const b = Math.max(...fs.map(bottom));
      out.push({
        text: sorted.map((g) => g.text.trim()).join('  '),
        frame: { left, top, width: r - left, height: b - top },
        blockId: group[0]!.blockId,
        sectionStart: group[0]!.sectionStart,
      });
    }
    group = [];
  };
  for (const l of lines) {
    const f = l.frame;
    const first = group[0]?.frame;
    if (f && first && !l.sectionStart && sameRow(first, f, group)) group.push(l);
    else {
      emit();
      group = [l];
    }
  }
  emit();
  return out;
}

function sameRow(a: OcrFrame, b: OcrFrame, group: OrderedLine[]): boolean {
  const top = Math.max(a.top, b.top);
  const bot = Math.min(bottom(a), bottom(b));
  const overlap = bot - top;
  const minH = Math.min(a.height, b.height);
  if (minH <= 0 || overlap < 0.6 * minH) return false;
  // and they must not overlap horizontally (otherwise they are different lines in a slanted photo)
  return (
    group.every((g) => {
      const gf = g.frame!;
      return right(gf) <= b.left + 2 || right(b) <= gf.left + 2;
    }) && Math.abs(centreY(a) - centreY(b)) < 0.6 * Math.max(a.height, b.height)
  );
}
