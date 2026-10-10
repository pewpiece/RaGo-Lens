import type { OcrElement } from './types';

/** Shown where the recogniser seems to have skipped a symbol; the user fills it in. Never replaced by a guess. */
export const GAP_MARK = '□';

/** Characters that make a line read as maths / an expression. */
export const MATH_CHARS = /[=<>≤≥≠≈±×÷√∑∫∞π^+*/−]|\d\s*[-–]\s*\d/;

const OPERATOR_ONLY = /^[=+\-−–—×÷*/^<>≤≥≠≈±()[\]{}.,:;|]+$/;

export const looksMathy = (s: string): boolean =>
  MATH_CHARS.test(s) &&
  /[\p{L}\d]/u.test(s) &&
  !/\p{L}{4,}/u.test(s.replace(/\b(sin|cos|tan|log|ln|lim)\b/g, ''));

/**
 * Rebuilds a maths-looking line from its words and marks unusually wide gaps between two words that are
 * neither an operator nor punctuation: that is where "=", "+" and similar thin symbols are most often lost.
 * Returns the line text and the number of marks added. Lines that do not look like maths are returned unchanged.
 */
export function markSymbolGaps(
  text: string,
  elements: OcrElement[] | undefined,
): { text: string; gaps: number } {
  if (!elements || elements.length < 2 || !looksMathy(text)) return { text, gaps: 0 };
  if (elements.some((e) => !e.frame)) return { text, gaps: 0 };
  const hs = elements.map((e) => e.frame!.height).sort((a, b) => a - b);
  const H = hs[Math.floor(hs.length / 2)]! || 1;
  const sorted = [...elements].sort((a, b) => a.frame!.left - b.frame!.left);
  let gaps = 0;
  let out = sorted[0]!.text;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const gap = b.frame!.left - (a.frame!.left + a.frame!.width);
    const operatorBetween = OPERATOR_ONLY.test(a.text) || OPERATOR_ONLY.test(b.text);
    const endsOpen = /[=+\-−×÷*/^<>≤≥≠(]$/.test(a.text) || /^[=+\-−×÷*/^<>≤≥≠)]/.test(b.text);
    if (gap > 1.1 * H && !operatorBetween && !endsOpen) {
      out += ` ${GAP_MARK} ${b.text}`;
      gaps++;
    } else out += ` ${b.text}`;
  }
  return { text: out, gaps };
}

/** Symbols offered in the editor's quick-insert row. */
export const SYMBOL_ROWS: string[][] = [
  ['=', '≠', '≈', '+', '−', '×', '÷', '±', '^', '/'],
  ['<', '>', '≤', '≥', '(', ')', '[', ']', '{', '}'],
  ['√', 'π', '∞', '∑', '∫', '²', '³', '°', '%', '→'],
];
