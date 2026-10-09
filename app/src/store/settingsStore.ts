import { create } from 'zustand';
import type { KeyValueStorage } from '@/db/kv';
import { DEFAULT_EXPORT_OPTIONS, parseExportOptions, type ExportOptions } from '@/export/options';

export const WORKING_SIZE_CHOICES = [1024, 1536, 2048, 3072] as const;
export const DEFAULT_WORKING_SIZE = 2048;

const KEYS = {
  exportDefaults: 'export_defaults',
  workingSize: 'working_size_cap',
  mockEngine: 'dev_mock_engine',
} as const;

export interface SettingsState {
  hydrated: boolean;
  exportDefaults: ExportOptions;
  /** Cap on the long edge of the image the pipeline works on. */
  workingSizeCap: number;
  /** Developer toggle: use the MockEngine instead of the ONNX model. */
  useMockEngine: boolean;
  hydrate(): Promise<void>;
  setExportDefaults(patch: Partial<ExportOptions>): Promise<void>;
  setWorkingSizeCap(px: number): Promise<void>;
  setUseMockEngine(on: boolean): Promise<void>;
}

export function clampWorkingSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_WORKING_SIZE;
  return Math.min(4096, Math.max(512, Math.round(px)));
}

export function createSettingsStore(kv: KeyValueStorage) {
  const safeSet = async (k: string, v: string) => {
    try {
      await kv.set(k, v);
    } catch {
      /* non-fatal: value stays for this session */
    }
  };
  return create<SettingsState>()((set, get) => ({
    hydrated: false,
    exportDefaults: DEFAULT_EXPORT_OPTIONS,
    workingSizeCap: DEFAULT_WORKING_SIZE,
    useMockEngine: false,
    async hydrate() {
      try {
        const [exp, size, mock] = await Promise.all([
          kv.get(KEYS.exportDefaults),
          kv.get(KEYS.workingSize),
          kv.get(KEYS.mockEngine),
        ]);
        set({
          exportDefaults: parseExportOptions(exp),
          workingSizeCap: size ? clampWorkingSize(Number(size)) : DEFAULT_WORKING_SIZE,
          useMockEngine: mock === '1',
          hydrated: true,
        });
      } catch {
        set({ hydrated: true });
      }
    },
    async setExportDefaults(patch) {
      const next = { ...get().exportDefaults, ...patch };
      set({ exportDefaults: next });
      await safeSet(KEYS.exportDefaults, JSON.stringify(next));
    },
    async setWorkingSizeCap(px) {
      const v = clampWorkingSize(px);
      set({ workingSizeCap: v });
      await safeSet(KEYS.workingSize, String(v));
    },
    async setUseMockEngine(on) {
      set({ useMockEngine: on });
      await safeSet(KEYS.mockEngine, on ? '1' : '0');
    },
  }));
}
