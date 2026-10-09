import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export type SyncDb = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** Small async key/value contract so stores can be tested without SQLite. */
export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function sqliteKv(db: SyncDb): KeyValueStorage {
  return {
    async get(key) {
      const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
      return row?.value ?? null;
    },
    async set(key, value) {
      db.insert(schema.settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
        .run();
    },
    async remove(key) {
      db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
    },
  };
}

export function memoryKv(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
  };
}
