import { getDb } from '@/db/client';
import { sqliteKv, type KeyValueStorage, type SyncDb } from '@/db/kv';
import { createSettingsStore } from './settingsStore';
import { createThemeStore } from './themeStore';

/** Lazy so importing this module never opens the database until first use. */
const lazyKv: KeyValueStorage = {
  get: (k) => sqliteKv(getDb() as unknown as SyncDb).get(k),
  set: (k, v) => sqliteKv(getDb() as unknown as SyncDb).set(k, v),
  remove: (k) => sqliteKv(getDb() as unknown as SyncDb).remove(k),
};

export const useThemeStore = createThemeStore(lazyKv);
export const useSettingsStore = createSettingsStore(lazyKv);
