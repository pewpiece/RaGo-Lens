import { create } from 'zustand';
import type { KeyValueStorage } from '@/db/kv';
import { DEFAULT_EXPORT_OPTIONS, parseExportOptions, type ExportOptions } from '@/export/options';
import { DEFAULT_EDGE, parseEdgeLevel, type EdgeLevel } from '@/engine/edge';
import { isViewMode, type ViewMode } from '@/editor/viewModes';
import type { ScanScript } from '@/scan/types';

export const WORKING_SIZE_CHOICES = [1024, 1536, 2048, 3072] as const;
export const DEFAULT_WORKING_SIZE = 2048;

const KEYS = {
  exportDefaults: 'export_defaults',
  workingSize: 'working_size_cap',
  mockEngine: 'dev_mock_engine',
  scanScript: 'scan_script',
  scanEnhance: 'scan_enhance',
  edge: 'cutout_edge',
  editorView: 'editor_view_mode',
  enhance: 'auto_enhance',
  remote: 'remote_engine',
} as const;

export interface AutoEnhanceSettings {
  enabled: boolean;
  /** 0..1 */
  strength: number;
  /** Also apply it to the exported picture. */
  exportToo: boolean;
}

export const DEFAULT_AUTO_ENHANCE: AutoEnhanceSettings = {
  enabled: false,
  strength: 0.6,
  exportToo: false,
};

export function parseAutoEnhance(raw: string | null): AutoEnhanceSettings {
  try {
    const o = JSON.parse(raw ?? '{}') as Partial<AutoEnhanceSettings>;
    return {
      enabled: o.enabled === true,
      strength:
        typeof o.strength === 'number' && Number.isFinite(o.strength)
          ? Math.min(1, Math.max(0, o.strength))
          : 0.6,
      exportToo: o.exportToo === true,
    };
  } catch {
    return DEFAULT_AUTO_ENHANCE;
  }
}

export interface RemoteSettings {
  enabled: boolean;
  baseUrl: string;
  token: string;
  /** 5..120 */
  timeoutSec: number;
}

export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = {
  enabled: false,
  baseUrl: '',
  token: '',
  timeoutSec: 30,
};

export function parseRemoteSettings(raw: string | null): RemoteSettings {
  try {
    const o = JSON.parse(raw ?? '{}') as Partial<RemoteSettings>;
    return {
      enabled: o.enabled === true,
      baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl.trim().slice(0, 200) : '',
      token: typeof o.token === 'string' ? o.token.slice(0, 200) : '',
      timeoutSec:
        typeof o.timeoutSec === 'number' && Number.isFinite(o.timeoutSec)
          ? Math.min(120, Math.max(5, Math.round(o.timeoutSec)))
          : 30,
    };
  } catch {
    return DEFAULT_REMOTE_SETTINGS;
  }
}

export interface SettingsState {
  hydrated: boolean;
  exportDefaults: ExportOptions;
  /** Cap on the long edge of the image the pipeline works on. */
  workingSizeCap: number;
  /** Developer toggle: use the MockEngine instead of the ONNX model. */
  useMockEngine: boolean;
  /** Writing system the Scan recogniser reads. */
  scanScript: ScanScript;
  /** Boost contrast of faint writing before Scan reads the page. */
  scanEnhance: boolean;
  /** How tightly cut-out edges hug the object. */
  edgeLevel: EdgeLevel;
  /** Last view mode used in the editor (null = pick by product brightness). */
  editorViewMode: ViewMode | null;
  /** Optional auto exposure / white balance before the cut-out. */
  autoEnhance: AutoEnhanceSettings;
  /** Optional HD engine on the user's own computer (LAN only, off by default). */
  remote: RemoteSettings;
  hydrate(): Promise<void>;
  setExportDefaults(patch: Partial<ExportOptions>): Promise<void>;
  setWorkingSizeCap(px: number): Promise<void>;
  setUseMockEngine(on: boolean): Promise<void>;
  setScanScript(script: ScanScript): Promise<void>;
  setScanEnhance(on: boolean): Promise<void>;
  setEdgeLevel(level: EdgeLevel): Promise<void>;
  setEditorViewMode(mode: ViewMode): Promise<void>;
  setAutoEnhance(patch: Partial<AutoEnhanceSettings>): Promise<void>;
  setRemote(patch: Partial<RemoteSettings>): Promise<void>;
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
    scanScript: 'latin',
    scanEnhance: true,
    edgeLevel: DEFAULT_EDGE,
    editorViewMode: null,
    autoEnhance: DEFAULT_AUTO_ENHANCE,
    remote: DEFAULT_REMOTE_SETTINGS,
    async hydrate() {
      try {
        const [exp, size, mock, script, enhance, edge, view, auto, remote] = await Promise.all([
          kv.get(KEYS.exportDefaults),
          kv.get(KEYS.workingSize),
          kv.get(KEYS.mockEngine),
          kv.get(KEYS.scanScript),
          kv.get(KEYS.scanEnhance),
          kv.get(KEYS.edge),
          kv.get(KEYS.editorView),
          kv.get(KEYS.enhance),
          kv.get(KEYS.remote),
        ]);
        set({
          exportDefaults: parseExportOptions(exp),
          workingSizeCap: size ? clampWorkingSize(Number(size)) : DEFAULT_WORKING_SIZE,
          useMockEngine: mock === '1',
          scanScript: script === 'devanagari' ? 'devanagari' : 'latin',
          scanEnhance: enhance !== '0',
          edgeLevel: parseEdgeLevel(edge),
          editorViewMode: isViewMode(view) ? view : null,
          autoEnhance: parseAutoEnhance(auto),
          remote: parseRemoteSettings(remote),
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
    async setRemote(patch) {
      const next = parseRemoteSettings(JSON.stringify({ ...get().remote, ...patch }));
      set({ remote: next });
      await safeSet(KEYS.remote, JSON.stringify(next));
    },
    async setAutoEnhance(patch) {
      const next = { ...get().autoEnhance, ...patch };
      next.strength = Math.min(1, Math.max(0, next.strength));
      set({ autoEnhance: next });
      await safeSet(KEYS.enhance, JSON.stringify(next));
    },
    async setEditorViewMode(mode) {
      set({ editorViewMode: mode });
      await safeSet(KEYS.editorView, mode);
    },
    async setEdgeLevel(level) {
      set({ edgeLevel: level });
      await safeSet(KEYS.edge, level);
    },
    async setScanEnhance(on) {
      set({ scanEnhance: on });
      await safeSet(KEYS.scanEnhance, on ? '1' : '0');
    },
    async setScanScript(script) {
      set({ scanScript: script });
      await safeSet(KEYS.scanScript, script);
    },
    async setUseMockEngine(on) {
      set({ useMockEngine: on });
      await safeSet(KEYS.mockEngine, on ? '1' : '0');
    },
  }));
}
