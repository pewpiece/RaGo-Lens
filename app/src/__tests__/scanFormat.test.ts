import { cleanLine, formatScan, parseMarker } from '@/scan/format';
import type { OcrBlock, OcrResult } from '@/scan/types';

/** Build a block of lines at given y positions; each line is [text, left?, height?]. */
function block(startTop: number, lines: [string, number?, number?][], lineGap = 6): OcrBlock {
  let top = startTop;
  const out = lines.map(([text, left = 20, height = 20]) => {
    const l = { text, frame: { left, top, width: Math.max(40, text.length * 9), height } };
    top += height + lineGap;
    return l;
  });
  return { text: lines.map((l) => l[0]).join('\n'), lines: out };
}
const result = (...blocks: OcrBlock[]): OcrResult => ({
  text: blocks.map((b) => b.text).join('\n'),
  blocks,
});

describe('parseMarker', () => {
  it('recognises bullets of many glyphs', () => {
    for (const m of ['-', '•', '*', '·', '●', '–']) {
      expect(parseMarker(`${m} buy milk`)).toEqual({ kind: 'bullet', rest: 'buy milk' });
    }
  });
  it('recognises numbered items', () => {
    expect(parseMarker('3. call mum')).toEqual({ kind: 'numbered', rest: 'call mum', number: '3' });
    expect(parseMarker('12) done')).toMatchObject({ kind: 'numbered', number: '12' });
  });
  it('does not eat words or negative numbers', () => {
    expect(parseMarker('ok then')).toEqual({ kind: 'text', rest: 'ok then' });
    expect(parseMarker('-5 degrees')).toEqual({ kind: 'text', rest: '-5 degrees' });
    expect(parseMarker('Hello')).toEqual({ kind: 'text', rest: 'Hello' });
  });
  it('treats "o item" as a bullet (common OCR of a hollow bullet)', () => {
    expect(parseMarker('o second point')).toEqual({ kind: 'bullet', rest: 'second point' });
  });
  it('treats a)/b) letters as list items', () => {
    expect(parseMarker('a) first')).toEqual({ kind: 'bullet', rest: 'first' });
  });
});

describe('cleanLine', () => {
  it('collapses whitespace and normalises quotes', () => {
    expect(cleanLine('  “Hi”   there friend ')).toBe('"Hi" there friend');
  });
});

describe('formatScan', () => {
  it('returns the raw text when there is no line geometry', () => {
    const r = formatScan({ text: 'just text', blocks: [] });
    expect(r.markdown).toBe('just text');
    expect(r.lines).toEqual([]);
  });

  it('formats a heading, a bullet list and a numbered list', () => {
    const r = formatScan(
      result(
        block(10, [['SHOPPING LIST', 20, 34]]),
        block(80, [['- milk'], ['- eggs'], ['- bread']]),
        block(190, [['1. wash car'], ['2. pay bills']]),
      ),
    );
    expect(r.markdown).toBe(
      '## SHOPPING LIST\n\n- milk\n- eggs\n- bread\n\n1. wash car\n2. pay bills',
    );
    expect(r.plain).toBe('SHOPPING LIST\n\n• milk\n• eggs\n• bread\n\n1. wash car\n2. pay bills');
    expect(r.lines.map((l) => l.kind)).toEqual([
      'heading',
      'bullet',
      'bullet',
      'bullet',
      'numbered',
      'numbered',
    ]);
  });

  it('keeps one-thought-per-line notes as separate lines (hard breaks in markdown)', () => {
    const r = formatScan(
      result(block(10, [['Meeting at 5'], ['Bring laptop'], ['Ask about budget']])),
    );
    expect(r.plain).toBe('Meeting at 5\nBring laptop\nAsk about budget');
    expect(r.markdown).toBe('Meeting at 5  \nBring laptop  \nAsk about budget');
  });

  it('inserts a blank line for a large vertical gap between lines in one block', () => {
    const b: OcrBlock = {
      text: '',
      lines: [
        { text: 'First paragraph.', frame: { left: 20, top: 10, width: 200, height: 20 } },
        { text: 'Second paragraph.', frame: { left: 20, top: 80, width: 200, height: 20 } },
      ],
    };
    expect(formatScan(result(b)).plain).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('indents nested bullets by their left offset', () => {
    const r = formatScan(
      result(
        block(10, [
          ['- parent', 20],
          ['- child', 70],
          ['- grandchild', 120],
        ]),
      ),
    );
    expect(r.lines.map((l) => l.indent)).toEqual([0, 1, 2]);
    expect(r.markdown).toBe('- parent\n  - child\n    - grandchild');
  });

  it('joins a soft-wrapped sentence but not a finished line', () => {
    // two wrapped lines that run to the right margin, then a short final line
    const wide = (t: string, top: number) => ({
      text: t,
      frame: { left: 20, top, width: 400, height: 20 },
    });
    const b: OcrBlock = {
      text: '',
      lines: [
        wide('This is a long sentence that wraps onto', 10),
        wide('the next line because the page is narrow', 36),
        { text: 'Done.', frame: { left: 20, top: 62, width: 50, height: 20 } },
      ],
    };
    const r = formatScan(result(b));
    expect(r.plain.split('\n')[0]).toBe(
      'This is a long sentence that wraps onto the next line because the page is narrow',
    );
    expect(r.plain.endsWith('Done.')).toBe(true);
  });

  it('repairs a hyphenated word break across wrapped lines', () => {
    const wide = (t: string, top: number) => ({
      text: t,
      frame: { left: 20, top, width: 400, height: 20 },
    });
    const b: OcrBlock = {
      text: '',
      lines: [wide('An important develop-', 10), wide('ment happened today', 36)],
    };
    expect(formatScan(result(b)).plain).toBe('An important development happened today');
  });

  it('does not make a heading out of a sentence', () => {
    const r = formatScan(result(block(10, [['THE END.', 20, 34]])));
    expect(r.lines[0]!.kind).toBe('text');
  });

  it('detects an all-caps short line standing alone as a heading', () => {
    const r = formatScan(
      result(
        block(10, [['MEETING NOTES']]),
        block(80, [['Discussed budget'], ['Agreed on dates']]),
      ),
    );
    expect(r.lines[0]!.kind).toBe('heading');
    expect(r.markdown.startsWith('## MEETING NOTES\n\nDiscussed budget')).toBe(true);
  });

  it('drops empty lines and tolerates lines without frames', () => {
    const b: OcrBlock = { text: '', lines: [{ text: '   ' }, { text: '- a' }, { text: '- b' }] };
    const r = formatScan(result(b));
    expect(r.plain).toBe('• a\n• b');
  });

  it('works for Devanagari text (no case, no regex assumptions about Latin)', () => {
    const r = formatScan(result(block(10, [['१. दूध किन्ने'], ['२. घर जाने']])));
    // Devanagari digits are not ASCII digits: kept as plain lines, never mangled
    expect(r.plain).toBe('१. दूध किन्ने\n२. घर जाने');
  });
});
