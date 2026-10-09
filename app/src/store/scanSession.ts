import { create } from 'zustand';
import type { ScanResult } from '@/scan/pipeline';
import type { ScanScript } from '@/scan/types';

/** In-memory state of the page being scanned (the library persists finished scans). */
export interface ScanSessionState {
  sourceUri: string | null;
  /** Script chosen via "Retry" for this run only; falls back to the Settings choice. */
  scriptOverride: ScanScript | null;
  result: ScanResult | null;
  /** Editable text shown in the editor (markdown). */
  text: string;
  itemId: string | null;
  /** True when opened from the library: skip recognition, show the saved text. */
  preloaded: boolean;
  notice: string | null;
  start(uri: string, scriptOverride?: ScanScript | null): void;
  setResult(result: ScanResult, itemId: string | null): void;
  setText(text: string): void;
  setNotice(n: string | null): void;
  openSaved(args: { sourceUri: string; text: string; itemId: string }): void;
  clear(): void;
}

const blank = {
  sourceUri: null,
  scriptOverride: null,
  result: null,
  text: '',
  itemId: null,
  preloaded: false,
  notice: null,
};

export const useScanSession = create<ScanSessionState>()((set) => ({
  ...blank,
  start: (uri, scriptOverride = null) => set({ ...blank, sourceUri: uri, scriptOverride }),
  setResult: (result, itemId) => set({ result, itemId, text: result.markdown }),
  setText: (text) => set({ text }),
  setNotice: (notice) => set({ notice }),
  openSaved: ({ sourceUri, text, itemId }) =>
    set({ ...blank, sourceUri, text, itemId, preloaded: true }),
  clear: () => set({ ...blank }),
}));
