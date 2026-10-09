import { Appearance } from 'react-native';
import { create } from 'zustand';
import type { KeyValueStorage } from '@/db/kv';
import type { ThemeMode } from '@/theme/tokens';

export const THEME_KEY = 'theme_mode';
export const isThemeMode = (v: unknown): v is ThemeMode =>
  v === 'system' || v === 'light' || v === 'dark';

export interface ThemeState {
  mode: ThemeMode;
  hydrated: boolean;
  hydrate(): Promise<void>;
  setMode(mode: ThemeMode): Promise<void>;
}

/** Applies the choice to the OS-level appearance so native chrome (status bar, dialogs) follows. */
function applyToSystem(mode: ThemeMode) {
  try {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  } catch {
    /* not available in some environments */
  }
}

export function createThemeStore(kv: KeyValueStorage) {
  return create<ThemeState>()((set, get) => ({
    mode: 'system',
    hydrated: false,
    async hydrate() {
      let mode: ThemeMode = 'system';
      try {
        const stored = await kv.get(THEME_KEY);
        if (isThemeMode(stored)) mode = stored;
      } catch {
        /* fall back to system */
      }
      applyToSystem(mode);
      set({ mode, hydrated: true });
    },
    async setMode(mode) {
      if (get().mode === mode) return;
      applyToSystem(mode);
      set({ mode }); // live: UI updates immediately, persistence follows
      try {
        await kv.set(THEME_KEY, mode);
      } catch {
        /* keep the in-memory choice for this session */
      }
    },
  }));
}
