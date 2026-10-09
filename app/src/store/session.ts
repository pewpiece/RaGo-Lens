import { create } from 'zustand';
import type { CutoutResult } from '@/engine/pipeline';

/** In-memory state of the photo currently being worked on (never persisted; the library persists results). */
export interface SessionState {
  /** Photo chosen/captured/shared and waiting to be processed. */
  sourceUri: string | null;
  /** Working-size override for "Retry with different settings". */
  capOverride: number | null;
  result: CutoutResult | null;
  /** Library row for the current result, once saved. */
  itemId: string | null;
  /** One-off message for the Result screen (e.g. the library could not be written). */
  notice: string | null;
  setNotice(text: string | null): void;
  setSource(uri: string, capOverride?: number | null): void;
  setResult(result: CutoutResult, itemId?: string | null): void;
  setItemId(id: string | null): void;
  replaceMask(maskLayer: CutoutResult['maskLayer'], maskUri: string): void;
  clear(): void;
}

export const useSession = create<SessionState>()((set) => ({
  sourceUri: null,
  capOverride: null,
  result: null,
  itemId: null,
  notice: null,
  setNotice: (notice) => set({ notice }),
  setSource: (uri, capOverride = null) =>
    set({ sourceUri: uri, capOverride, result: null, itemId: null, notice: null }),
  setResult: (result, itemId = null) => set({ result, itemId }),
  setItemId: (itemId) => set({ itemId }),
  replaceMask: (maskLayer, maskUri) =>
    set((s) => (s.result ? { result: { ...s.result, maskLayer, maskUri, foundObject: true } } : s)),
  clear: () =>
    set({ sourceUri: null, capOverride: null, result: null, itemId: null, notice: null }),
}));
