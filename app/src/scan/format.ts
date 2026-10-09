import type {
  FormattedKind,
  FormattedLine,
  FormattedScan,
  OcrBlock,
  OcrLine,
  OcrResult,
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

function toRows(blocks: OcrBlock[]): Row[] {
  const rows: Row[] = [];
  blocks.forEach((b) => {
    b.lines.forEach((l: OcrLine, i) => {
      const text = cleanLine(l.text);
      if (!text) return;
      const f = l.frame;
      rows.push({
        text,
        left: f?.left ?? 0,
        top: f?.top ?? 0,
        right: f ? f.left + f.width : 0,
        bottom: f ? f.top + f.height : 0,
        height: f?.height ?? 0,
        hasFrame: !!f,
        newBlock: i === 0,
      });
    });
  });
  return rows;
}

/** Strip a list marker, returning its kind (or 'text' when there is none). */
export function parseMarker(text: string): { kind: FormattedKind; rest: string; number?: string } {
  const num = NUMBER_RE.exec(text);
  if (num) return { kind: 'numbered', rest: text.slice(num[0].length).trim(), number: num[1] };
  const bul = BULLET_RE.exec(text);
  // "o" and "-" must be followed by a space-separated word to count as a bullet (avoid eating "ok", "-5")
  if (bul && bul[0].length > 0 && text.length > bul[0].length) {
    const marker = bul[0].trim();
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
  const rows = toRows(result.blocks);
  if (rows.length === 0) {
    const fallback = cleanLine(result.text);
    return { lines: [], markdown: fallback, plain: fallback };
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
    const paragraphBreak = idx > 0 && (r.newBlock ? gap > 0.55 * H : gap > 1.0 * H);

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

  return { lines: out, markdown: toMarkdown(out), plain: toPlain(out) };
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
