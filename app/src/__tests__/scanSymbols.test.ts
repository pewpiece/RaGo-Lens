import { formatScan, parseMarker, renderFormat, toParagraphs } from '@/scan/format';
import { headingSet, previewLines } from '@/scan/preview';
import { GAP_MARK, markSymbolGaps } from '@/scan/symbols';
import { mapMlKitResult } from '@/scan/mlkitEngine';
import { parseSavedScan } from '@/scan/savedScan';
import type { OcrResult } from '@/scan/types';

const f = (left: number, top: number, width: number, height = 20) => ({ left, top, width, height });
const line = (text: string, top: number, left = 10) => ({
  text,
  frame: f(left, top, text.length * 10),
});
const page = (...texts: string[]): OcrResult => {
  const lines = texts.map((t, i) => line(t, 10 + i * 30));
  return { text: texts.join('\n'), blocks: [{ text: texts.join('\n'), lines }] };
};

describe('symbols survive formatting', () => {
  it.each([
    'x = 5',
    '+ 3 = 5',
    '- 2x + 4 = 0',
    '> 4 means a bigger number',
    '* 3 = 6',
    'a ≤ b ≠ c',
    '√9 = 3',
    'π ≈ 3.14',
    'E = mc²',
    '∑ x = 10',
    '- b ± √(b² - 4ac)',
  ])('keeps every character of "%s"', (t) => {
    const out = formatScan(page(t));
    expect(out.plain).toBe(t);
    expect(out.markdown).toBe(t);
    expect(out.paragraphs).toBe(t);
  });

  it('still treats a real dash or star bullet as a list item', () => {
    expect(parseMarker('- buy milk')).toEqual({ kind: 'bullet', rest: 'buy milk' });
    expect(parseMarker('* call Sam').kind).toBe('bullet');
    expect(parseMarker('+ 3 = 5').kind).toBe('text');
  });
});

describe('missing-symbol marks', () => {
  const el = (text: string, left: number, width: number) => ({ text, frame: f(left, 0, width) });
  it('marks a wide gap between two operands in a maths line, and never guesses the symbol', () => {
    const r = markSymbolGaps('x 5 + 2', [
      el('x', 0, 10),
      el('5', 60, 10),
      el('+', 80, 10),
      el('2', 100, 10),
    ]);
    expect(r.gaps).toBe(1);
    expect(r.text).toBe(`x ${GAP_MARK} 5 + 2`);
    expect(r.text).not.toContain('=');
  });
  it('leaves normal gaps, operators and prose alone', () => {
    expect(markSymbolGaps('x = 5', [el('x', 0, 10), el('=', 40, 10), el('5', 80, 10)]).gaps).toBe(
      0,
    );
    expect(
      markSymbolGaps('hello wide world', [
        el('hello', 0, 50),
        el('wide', 200, 40),
        el('world', 400, 50),
      ]).gaps,
    ).toBe(0);
    expect(markSymbolGaps('x 5 + 2', undefined).gaps).toBe(0);
  });
  it('counts the marks on the scan and keeps them in every layout', () => {
    const lines = [
      {
        text: 'x 5 + 2',
        frame: f(0, 0, 110),
        elements: [el('x', 0, 10), el('5', 60, 10), el('+', 80, 10), el('2', 100, 10)],
      },
    ];
    const out = formatScan({ text: 'x 5 + 2', blocks: [{ text: '', lines }] });
    expect(out.gapCount).toBe(1);
    expect(out.plain).toContain(GAP_MARK);
    expect(out.markdown).toContain(GAP_MARK);
    expect(out.paragraphs).toContain(GAP_MARK);
  });
  it('passes the words through from ML Kit', () => {
    const r = mapMlKitResult({
      text: 'a',
      blocks: [{ text: 'a', lines: [{ text: 'a', elements: [{ text: 'a', frame: f(1, 2, 3) }] }] }],
    });
    expect(r.blocks[0]!.lines[0]!.elements).toEqual([{ text: 'a', frame: f(1, 2, 3) }]);
  });
});

describe('text layouts', () => {
  const sample: OcrResult = {
    text: '',
    blocks: [
      {
        text: '',
        lines: [
          { text: 'MEETING NOTES', frame: f(10, 10, 200, 40) },
          { text: 'we talked about the plan', frame: f(10, 80, 300) },
          { text: 'and the budget today', frame: f(10, 104, 120) },
          { text: '- first item', frame: f(10, 170, 400) },
          { text: 'x = 5', frame: f(10, 230, 100) },
          { text: 'y = 6', frame: f(10, 254, 100) },
        ],
      },
    ],
  };
  const out = formatScan(sample);
  it('plain keeps each recognised line; no # or - symbols', () => {
    expect(out.plain).not.toMatch(/^#|^- /m);
    expect(out.plain).toContain('we talked about the plan\nand the budget today');
  });
  it('paragraphs join wrapped prose into one paragraph but keep maths lines apart', () => {
    expect(out.paragraphs).toContain('we talked about the plan and the budget today');
    expect(out.paragraphs).toContain('x = 5\ny = 6');
    expect(out.paragraphs).toContain('• first item');
  });
  it('markdown marks the heading and the bullet', () => {
    expect(out.markdown).toContain('## MEETING NOTES');
    expect(out.markdown).toContain('- first item');
  });
  it('renderFormat picks the layout', () => {
    expect(renderFormat(out, 'plain')).toBe(out.plain);
    expect(renderFormat(out, 'paragraphs')).toBe(out.paragraphs);
    expect(renderFormat(out, 'markdown')).toBe(out.markdown);
    expect(toParagraphs([])).toBe('');
  });
});

describe('preview headings', () => {
  it('finds headings from the markdown layout and from # lines', () => {
    const set = headingSet('## Title\n\ntext\n\n# Other');
    expect([...set]).toEqual(['Title', 'Other']);
    const lines = previewLines('Title\nbody\n\n## New', set);
    expect(lines.map((l) => l.heading)).toEqual([true, false, false, true]);
    expect(lines[3]!.text).toBe('New');
    expect(lines[2]!.blank).toBe(true);
  });
});

describe('saved scan settings', () => {
  it('parses the stored layouts and ignores junk', () => {
    const texts = { plain: 'a', paragraphs: 'b', markdown: 'c' };
    expect(parseSavedScan(JSON.stringify({ format: 'markdown', texts }))).toEqual({
      format: 'markdown',
      texts,
    });
    expect(parseSavedScan(JSON.stringify({ format: 'x', texts: { plain: 1 } }))).toEqual({
      format: undefined,
      texts: null,
    });
    expect(parseSavedScan('not json')).toEqual({});
  });
});
