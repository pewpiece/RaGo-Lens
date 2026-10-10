import { create } from 'zustand';
import type { ScanResult } from '@/scan/pipeline';
import type { ScanScript, TextFormat } from '@/scan/types';

/** The three layouts of one scan, so the format can be switched after scanning. */
export type ScanTexts = Record<TextFormat, string>;

/** In-memory state of the page being scanned (the library persists finished scans). */
export interface ScanSessionState {
  sourceUri: string | null;
  /** Script chosen via "Retry" for this run only; falls back to the Settings choice. */
  scriptOverride: ScanScript | null;
  /** Contrast boost chosen via "Retry" for this run only; falls back to the Settings choice. */
  enhanceOverride: boolean | null;
  result: ScanResult | null;
  /** Editable text shown in the editor, in the chosen format. */
  text: string;
  format: TextFormat;
  /** All layouts of the scan (null when unknown, e.g. an old saved scan). */
  texts: ScanTexts | null;
  gapCount: number;
  itemId: string | null;
  /** True when opened from the library: skip recognition, show the saved text. */
  preloaded: boolean;
  notice: string | null;
  start(uri: string, scriptOverride?: ScanScript | null, enhanceOverride?: boolean | null): void;
  setResult(result: ScanResult, itemId: string | null): void;
  setText(text: string): void;
  setNotice(n: string | null): void;
  setFormat(format: TextFormat): void;
  openSaved(args: {
    sourceUri: string;
    text: string;
    itemId: string;
    format?: TextFormat;
    texts?: ScanTexts | null;
  }): void;
  clear(): void;
}

const blank = {
  sourceUri: null,
  scriptOverride: null,
  enhanceOverride: null,
  result: null,
  text: '',
  format: 'plain' as TextFormat,
  texts: null as ScanTexts | null,
  gapCount: 0,
  itemId: null,
  preloaded: false,
  notice: null,
};

export const useScanSession = create<ScanSessionState>()((set) => ({
  ...blank,
  start: (uri, scriptOverride = null, enhanceOverride = null) =>
    set({ ...blank, sourceUri: uri, scriptOverride, enhanceOverride }),
  setResult: (result, itemId) => {
    const texts: ScanTexts = {
      plain: result.formatted.plain,
      paragraphs: result.formatted.paragraphs,
      markdown: result.formatted.markdown,
    };
    set({
      result,
      itemId,
      texts,
      text: texts.plain,
      format: 'plain',
      gapCount: result.formatted.gapCount,
    });
  },
  setFormat: (format) => set((s) => ({ format, text: s.texts ? s.texts[format] : s.text })),
  setText: (text) => set({ text }),
  setNotice: (notice) => set({ notice }),
  openSaved: ({ sourceUri, text, itemId, format = 'plain', texts = null }) =>
    set({ ...blank, sourceUri, text, itemId, format, texts, preloaded: true }),
  clear: () => set({ ...blank }),
}));
