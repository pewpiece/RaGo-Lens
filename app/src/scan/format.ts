import { mergeRows, readingOrder, type FlatLine } from './layout';
import { looksMathy, markSymbolGaps, GAP_MARK } from './symbols';
import type {
  FormattedKind,
  FormattedLine,
  FormattedScan,
  OcrBlock,
  OcrResult,
  TextFormat,
} from './types';

const BULLET_RE = /^\s*(?:[-–—•·●○▪■□◦*>»]|o(?=\s)|\+)\s*/;
const NUMBER_RE = /^\s*(\d{1,3})\s*[.):]\s+/;
const LETTER_RE = /^\s*([a-zA-Z])\s*[.)]\s+/;
const ENDS_SENTENCE_RE = /[.!?:;।]["')\]]?\s*$/;

interface Row {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  height: number;
  hasFrame: boolean;
  newBlock: boolean;
  /** First line of a column or band: the gap to the previous line is a layout jump, not a paragraph gap. */
  sectionStart: boolean;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Collapse whitespace, normalise odd quotes/dashes OCR often emits. */
export function cleanLine(s: string): string {
  return s
    .replace(/[  -​ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function toRows(blocks: OcrBlock[], counter: { gaps: number }): Row[] {
  const flat: FlatLine[] = [];
  blocks.forEach((b, blockId) => {
    b.lines.forEach((l) => {
      const text = cleanLine(l.text);
      if (text) flat.push({ text, frame: l.frame, blockId, elements: l.elements });
    });
  });
  // multi-column pages are read column by column; split rows (label + expression) are re-joined
  const ordered = mergeRows(readingOrder(flat));
  let prevBlock = -1;
  return ordered.map((l) => {
    const f = l.frame;
    const marked = markSymbolGaps(l.text, l.elements);
    counter.gaps += marked.gaps;
    const row: Row = {
      text: marked.text,
      left: f?.left ?? 0,
      top: f?.top ?? 0,
      right: f ? f.left + f.width : 0,
      bottom: f ? f.top + f.height : 0,
      height: f?.height ?? 0,
      hasFrame: !!f,
      newBlock: l.sectionStart || l.blockId !== prevBlock,
      sectionStart: l.sectionStart,
    };
    prevBlock = l.blockId;
    return row;
  });
}

/** Strip a list marker, returning its kind (or 'text' when there is none). */
export function parseMarker(text: string): { kind: FormattedKind; rest: string; number?: string } {
  const num = NUMBER_RE.exec(text);
  if (num) return { kind: 'numbered', rest: text.slice(num[0].length).trim(), number: num[1] };
  const bul = BULLET_RE.exec(text);
  // "o" and "-" must be followed by a space-separated word to count as a bullet (avoid eating "ok", "-5")
  if (bul && bul[0].length > 0 && text.length > bul[0].length) {
    const marker = bul[0].trim();
    // "+ 3 = 5", "- 2x", "> 4", "* 3": operators at the start of a maths line are symbols, not list markers
    if (/^[-–—+*>»]$/.test(marker)) {
      const rest = text.slice(bul[0].length);
      if (!/^\p{L}/u.test(rest) || looksMathy(rest)) return { kind: 'text', rest: text };
    }
    if (marker === 'o' || marker === '+' || /^[-–—*>»]$/.test(marker)) {
      if (!/^\s*\S\s+\S/.test(text)) return { kind: 'text', rest: text };
    }
    return { kind: 'bullet', rest: text.slice(bul[0].length).trim() };
  }
  const let_ = LETTER_RE.exec(text);
  if (let_) return { kind: 'bullet', rest: text.slice(let_[0].length).trim() };
  return { kind: 'text', rest: text };
}

const isMostlyUpper = (s: string): boolean => {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return (
    letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
  );
};

/**
 * Turns raw OCR lines into structured notes using geometry: paragraph gaps, heading size, list markers and
 * indentation. It is deliberately conservative: when unsure it keeps the line as plain text on its own line,
 * because notebook pages are mostly one-thought-per-line and reflowing them destroys the structure.
 */
export function formatScan(result: OcrResult): FormattedScan {
  const counter = { gaps: 0 };
  const rows = toRows(result.blocks, counter);
  if (rows.length === 0) {
    const fallback = cleanLine(result.text);
    return { lines: [], markdown: fallback, plain: fallback, paragraphs: fallback, gapCount: 0 };
  }
  const framed = rows.filter((r) => r.hasFrame && r.height > 0);
  const H = median(framed.map((r) => r.height)) || 1;
  const baseLeft = framed.length ? Math.min(...framed.map((r) => r.left)) : 0;
  const maxRight = framed.length ? Math.max(...framed.map((r) => r.right)) : 0;

  const out: FormattedLine[] = [];
  let prev: Row | null = null;
  rows.forEach((r, idx) => {
    const marker = parseMarker(r.text);
    const gap = prev && r.hasFrame && prev.hasFrame ? r.top - prev.bottom : 0;
    const paragraphBreak =
      idx > 0 && (r.sectionStart || (r.newBlock ? gap > 0.55 * H : gap > 1.0 * H));

    // Heading: clearly larger text (or all-caps) that is short and not a list item.
    let kind: FormattedKind = marker.kind;
    const short = marker.rest.length <= 70;
    if (kind === 'text' && short && r.hasFrame) {
      const bigger = r.height >= 1.35 * H;
      const caps = isMostlyUpper(marker.rest) && marker.rest.length <= 50;
      const nextRow = rows[idx + 1];
      const standsAlone =
        paragraphBreak ||
        idx === 0 ||
        !nextRow ||
        (nextRow.hasFrame && nextRow.top - r.bottom > 0.5 * H);
      if ((bigger || (caps && standsAlone)) && !ENDS_SENTENCE_RE.test(marker.rest))
        kind = 'heading';
    }

    const indent =
      kind === 'bullet' || kind === 'numbered'
        ? Math.max(0, Math.min(4, Math.floor((r.left - baseLeft) / (2.2 * H))))
        : 0;

    // Soft-wrapped paragraph text: join with the previous text line instead of keeping a hard break.
    const last = out[out.length - 1];
    const canJoin =
      kind === 'text' &&
      !paragraphBreak &&
      last &&
      last.kind === 'text' &&
      prev &&
      prev.hasFrame &&
      r.hasFrame &&
      prev.right >= maxRight - 1.2 * H && // previous line ran to the right margin
      !ENDS_SENTENCE_RE.test(prev.text) &&
      /^[\p{Ll}\d(]/u.test(marker.rest);
    if (canJoin && last) {
      last.text =
        /-$/.test(last.text) && /^\p{Ll}/u.test(marker.rest)
          ? last.text.slice(0, -1) + marker.rest
          : `${last.text} ${marker.rest}`;
    } else {
      out.push({ kind, text: marker.rest, indent, number: marker.number, paragraphBreak });
    }
    prev = r;
  });

  return {
    lines: out,
    markdown: toMarkdown(out),
    plain: toPlain(out),
    paragraphs: toParagraphs(out),
    gapCount: counter.gaps,
  };
}

export function toMarkdown(lines: FormattedLine[]): string {
  const parts: string[] = [];
  lines.forEach((l, i) => {
    const pad = '  '.repeat(l.indent);
    let s: string;
    if (l.kind === 'heading') s = `## ${l.text}`;
    else if (l.kind === 'bullet') s = `${pad}- ${l.text}`;
    else if (l.kind === 'numbered') s = `${pad}${l.number ?? '1'}. ${l.text}`;
    else s = l.text;
    const needsBlank =
      i > 0 && (l.paragraphBreak || l.kind === 'heading' || lines[i - 1]!.kind === 'heading');
    // plain consecutive text lines need a hard line break in markdown
    const prevLine = lines[i - 1];
    const hardBreak = i > 0 && !needsBlank && l.kind === 'text' && prevLine?.kind === 'text';
    if (i > 0) parts.push(needsBlank ? '\n\n' : hardBreak ? '  \n' : '\n');
    parts.push(s);
  });
  return parts.join('').trim();
}

export function toPlain(lines: FormattedLine[]): string {
  const parts: string[] = [];
  lines.forEach((l, i) => {
    const pad = '  '.repeat(l.indent);
    let s: string;
    if (l.kind === 'bullet') s = `${pad}• ${l.text}`;
    else if (l.kind === 'numbered') s = `${pad}${l.number ?? '1'}. ${l.text}`;
    else s = l.text;
    if (i > 0)
      parts.push(
        l.paragraphBreak || l.kind === 'heading' || lines[i - 1]!.kind === 'heading'
          ? '\n\n'
          : '\n',
      );
    parts.push(s);
  });
  return parts.join('').trim();
}

/** Text lines that belong together are joined into one paragraph; blank lines separate paragraphs and headings. */
export function toParagraphs(lines: FormattedLine[]): string {
  const paras: string[] = [];
  let cur: string | null = null;
  const flush = () => {
    if (cur !== null) paras.push(cur);
    cur = null;
  };
  lines.forEach((l, i) => {
    const pad = '  '.repeat(l.indent);
    if (l.kind === 'heading') {
      flush();
      paras.push(l.text);
    } else if (l.kind === 'bullet' || l.kind === 'numbered') {
      flush();
      paras.push(`${pad}${l.kind === 'bullet' ? '•' : `${l.number ?? '1'}.`} ${l.text}`);
    } else if (cur !== null && !l.paragraphBreak && lines[i - 1]?.kind === 'text') {
      // maths lines are never glued to their neighbours
      cur = looksMathy(cur) || looksMathy(l.text) ? `${cur}\n${l.text}` : `${cur} ${l.text}`;
    } else {
      flush();
      cur = l.text;
    }
  });
  flush();
  // list items and headings sit directly under each other; paragraphs are separated by a blank line
  return paras.join('\n\n').trim();
}

/** The text for a chosen layout. */
export function renderFormat(
  f: Pick<FormattedScan, 'plain' | 'paragraphs' | 'markdown'>,
  mode: TextFormat,
): string {
  return mode === 'markdown' ? f.markdown : mode === 'paragraphs' ? f.paragraphs : f.plain;
}

export { GAP_MARK };
