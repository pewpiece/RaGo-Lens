import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { runMigrations } from './migrations';
import * as schema from './schema';

let cached: ReturnType<typeof create> | null = null;

function create() {
  const sqlite = openDatabaseSync('ragolens.db');
  sqlite.execSync('PRAGMA journal_mode = WAL');
  runMigrations(sqlite);
  return drizzle(sqlite, { schema });
}

/** Lazily opens (and migrates) the app database. */
export function getDb() {
  if (!cached) cached = create();
  return cached;
}

export type AppDb = ReturnType<typeof getDb>;
