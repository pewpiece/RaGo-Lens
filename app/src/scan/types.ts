export type ScanScript = 'latin' | 'devanagari';

export interface OcrFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrElement {
  text: string;
  frame?: OcrFrame;
}

export interface OcrLine {
  text: string;
  frame?: OcrFrame;
  /** Words (or symbols) of the line, when the recogniser reports them. */
  elements?: OcrElement[];
}

export interface OcrBlock {
  text: string;
  frame?: OcrFrame;
  lines: OcrLine[];
}

/** Raw recognition result (engine independent). Coordinates are image pixels. */
export interface OcrResult {
  text: string;
  blocks: OcrBlock[];
}

export interface OcrRunOptions {
  script: ScanScript;
  signal?: AbortSignal;
}

/** A swappable text recogniser. Phase 2 ships ML Kit; tests and the developer toggle use a mock. */
export interface OcrEngine {
  readonly id: string;
  readonly label: string;
  recognize(imageUri: string, options: OcrRunOptions): Promise<OcrResult>;
}

export type FormattedKind = 'heading' | 'bullet' | 'numbered' | 'text';

export interface FormattedLine {
  kind: FormattedKind;
  /** Text without list markers. */
  text: string;
  /** Nesting level for list items, 0 = top. */
  indent: number;
  /** Original number for numbered items ("3" from "3."). */
  number?: string;
  /** True when a blank line separates this line from the previous one. */
  paragraphBreak: boolean;
}

/** How the finished text is laid out: plain lines, joined paragraphs, or Markdown (headings with #). */
export type TextFormat = 'plain' | 'paragraphs' | 'markdown';

export interface FormattedScan {
  lines: FormattedLine[];
  /** Markdown: headings (#), bullets (-), numbers (1.) and paragraphs. */
  markdown: string;
  /** Plain text, one line per recognised line, simple bullets, no markup. */
  plain: string;
  /** Plain text where wrapped lines are joined into paragraphs separated by a blank line. */
  paragraphs: string;
  /** Number of places where a symbol may be missing (marked with the gap mark in the text). */
  gapCount: number;
}
