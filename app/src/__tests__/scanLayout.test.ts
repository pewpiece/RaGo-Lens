import { formatScan } from '@/scan/format';
import { findGutter, mergeRows, readingOrder, type FlatLine } from '@/scan/layout';
import type { OcrBlock, OcrLine, OcrResult } from '@/scan/types';

const line = (text: string, left: number, top: number, width = 300, height = 26): OcrLine => ({
  text,
  frame: { left, top, width, height },
});
const asBlocks = (lines: OcrLine[]): OcrBlock[] =>
  lines.map((l) => ({ text: l.text, frame: l.frame, lines: [l] }));
const flat = (lines: OcrLine[]): FlatLine[] => lines.map((l, i) => ({ ...l, blockId: i }));

/**
 * A page shaped like the formula sheet in the bug report (1204 x 1600 photo): a full-width title, a left column
 * (x 55..570), a right column (x 620..1150) and a bottom-left section. The recogniser returns the blocks in a
 * scrambled order (bottom-left section early), exactly as seen on the phone.
 */
function formulaPage(): OcrLine[] {
  return [
    line('SOME IMPORTANT MATHEMATICAL FORMULAE', 140, 70, 920, 50),
    // left column
    line('1 (a+b)2 = a2 + 2ab + b2', 85, 175, 330),
    line('2 (a-b)2 = a2 - 2ab + b2', 85, 218, 330),
    line('3 a2 - b2 = (a+b)(a-b)', 85, 258, 330),
    line('4 a2 + b2 = (a+b)2 - 2ab', 85, 296, 400),
    line('6 (a-b)3', 75, 415, 90), // label ...
    line('= a3 - 3a2b - 3ab2 - b3', 225, 408, 260), // ... and expression on the same row
    line('10 (x+a)(x-b) = x2 + (a+b)x + ab', 60, 742, 360),
    line('1 Area of a circle (A) = TTr2', 50, 958, 340),
    line('2 Circumference of a circle (C) = 2Tr', 50, 1002, 420),
    line('For Cylinder', 40, 1265, 130),
    line('1 Area of curved surface = 2Trh', 40, 1312, 330),
    line('3 Volume (V) = Tr2h', 40, 1400, 300),
    // right column
    line('For Sphere', 622, 170, 110),
    line('1 Area (A) = 4Tr2', 622, 210, 220),
    line('For Hemisphere', 622, 322, 160),
    line('1 Area of curved surface = 2Tr2', 622, 362, 400),
    line('1 Profit = Selling Price - Cost Price', 622, 958, 500),
    line('2 Loss = C.P. - S.P', 622, 1002, 210),
  ];
}

describe('findGutter', () => {
  it('finds the gap between the columns and ignores the full-width title', () => {
    const g = findGutter(formulaPage().map((l) => ({ frame: l.frame! })))!;
    expect(g).not.toBeNull();
    expect(g.start).toBeGreaterThan(480);
    expect(g.end).toBeLessThanOrEqual(622);
  });

  it('returns null for a single column of text', () => {
    const single = Array.from({ length: 10 }, (_, i) => ({
      frame: { left: 50, top: 50 + i * 40, width: 500, height: 26 },
    }));
    expect(findGutter(single)).toBeNull();
  });

  it('returns null for too few lines or when one side is nearly empty', () => {
    expect(findGutter([{ frame: { left: 0, top: 0, width: 10, height: 10 } }])).toBeNull();
    const lopsided = [
      ...Array.from({ length: 8 }, (_, i) => ({
        frame: { left: 50, top: 50 + i * 40, width: 300, height: 26 },
      })),
      { frame: { left: 700, top: 50, width: 100, height: 26 } },
      { frame: { left: 700, top: 90, width: 100, height: 26 } },
    ];
    expect(findGutter(lopsided)).toBeNull();
  });
});

describe('readingOrder', () => {
  it('reads the title, then the whole left column, then the whole right column', () => {
    const scrambled = formulaPage();
    // put the bottom-left section and some right-column lines first, like the recogniser did
    const order = [0, 10, 11, 12, 13, 14, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17, 18].map(
      (i) => scrambled[i]!,
    );
    const out = readingOrder(flat(order)).map((l) => l.text);
    expect(out[0]).toBe('SOME IMPORTANT MATHEMATICAL FORMULAE');
    const iCyl = out.indexOf('For Cylinder');
    const iSphere = out.indexOf('For Sphere');
    const iCircle = out.indexOf('1 Area of a circle (A) = TTr2');
    expect(iCircle).toBeLessThan(iCyl); // left column top -> bottom
    expect(iCyl).toBeLessThan(iSphere); // all of the left column before the right one
    expect(out.indexOf('3 Volume (V) = Tr2h')).toBeLessThan(iSphere);
    expect(out.indexOf('1 Area (A) = 4Tr2')).toBeGreaterThan(iSphere);
    expect(out.indexOf('2 Loss = C.P. - S.P')).toBe(out.length - 1);
  });

  it('marks the start of each column as a section start', () => {
    const out = readingOrder(flat(formulaPage()));
    const starts = out.filter((l) => l.sectionStart).map((l) => l.text);
    expect(starts).toEqual(
      expect.arrayContaining([
        'SOME IMPORTANT MATHEMATICAL FORMULAE',
        '1 (a+b)2 = a2 + 2ab + b2',
        'For Sphere',
      ]),
    );
  });

  it('keeps the recogniser order for single-column pages and for lines without frames', () => {
    const lines = flat([line('b', 10, 100), line('a', 10, 50)]);
    expect(readingOrder(lines).map((l) => l.text)).toEqual(['b', 'a']);
    const noFrames: FlatLine[] = [
      { text: 'x', blockId: 0 },
      { text: 'y', blockId: 0 },
    ];
    expect(readingOrder(noFrames).map((l) => l.text)).toEqual(['x', 'y']);
    expect(readingOrder([])).toEqual([]);
  });
});

describe('mergeRows', () => {
  it('joins a label and its expression recognised as separate lines on one visual row', () => {
    const ordered = readingOrder(
      flat([
        line('6 (a-b)3', 75, 415, 90),
        line('= a3 - 3a2b', 225, 408, 200),
        line('next row', 75, 460, 150),
      ]),
    );
    const merged = mergeRows(ordered);
    expect(merged.map((l) => l.text)).toEqual(['6 (a-b)3  = a3 - 3a2b', 'next row']);
    expect(merged[0]!.frame!.left).toBe(75);
  });

  it('does not merge lines that overlap horizontally or sit on different rows', () => {
    const stacked = mergeRows(
      readingOrder(flat([line('PNR', 800, 500, 60), line('100', 810, 535, 40)])),
    );
    expect(stacked).toHaveLength(2);
    const overlapping = mergeRows(
      readingOrder(flat([line('abc', 100, 100, 200), line('def', 150, 104, 200)])),
    );
    expect(overlapping).toHaveLength(2);
  });
});

describe('formatScan on a two-column page', () => {
  const result = (lines: OcrLine[]): OcrResult => ({
    text: lines.map((l) => l.text).join('\n'),
    blocks: asBlocks(lines),
  });

  it('produces the columns in order with the title first and a break between columns', () => {
    const order = [0, 15, 16, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 17, 18].map(
      (i) => formulaPage()[i]!,
    );
    const r = formatScan(result(order));
    const lines = r.plain.split('\n').filter(Boolean);
    expect(lines[0]).toBe('SOME IMPORTANT MATHEMATICAL FORMULAE');
    expect(r.plain.indexOf('For Cylinder')).toBeLessThan(r.plain.indexOf('For Sphere'));
    expect(r.plain.indexOf('1 Area of a circle')).toBeLessThan(r.plain.indexOf('For Cylinder'));
    // label + expression ended up on one row
    expect(r.plain).toContain('6 (a-b)3  = a3 - 3a2b - 3ab2 - b3');
    // the jump from the left column to the right one is a paragraph break, not a run-on
    expect(r.plain).toMatch(/Tr2h\n\n.*For Sphere/s);
  });
});
