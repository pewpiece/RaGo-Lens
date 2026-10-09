export type ScanScript = 'latin' | 'devanagari';

export interface OcrFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  frame?: OcrFrame;
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

export interface FormattedScan {
  lines: FormattedLine[];
  /** Markdown: headings (#), bullets (-), numbers (1.) and paragraphs. */
  markdown: string;
  /** Plain text with simple bullets, no markup. */
  plain: string;
}
