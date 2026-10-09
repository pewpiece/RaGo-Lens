/**
 * Hand-written, append-only migrations tracked with `PRAGMA user_version`.
 * Never edit a released migration: add a new entry at the end.
 */
export const MIGRATIONS: readonly string[] = [
  // v1: initial schema
  `CREATE TABLE IF NOT EXISTS results (
     id TEXT PRIMARY KEY NOT NULL,
     mode TEXT NOT NULL,
     original_uri TEXT NOT NULL,
     result_uri TEXT NOT NULL,
     thumb_uri TEXT NOT NULL,
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     settings_json TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS results_created_at_idx ON results (created_at);
   CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
];

/** The minimal slice of the expo-sqlite API the migration runner needs. */
export interface MigratableDb {
  execSync(sql: string): void;
  getFirstSync<T>(sql: string): T | null;
}

export function runMigrations(
  db: MigratableDb,
  migrations: readonly string[] = MIGRATIONS,
): number {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current > migrations.length) {
    throw new Error(
      `Database is newer (v${current}) than this app understands (v${migrations.length}).`,
    );
  }
  for (let v = current; v < migrations.length; v++) {
    db.execSync('BEGIN');
    try {
      db.execSync(migrations[v]!);
      db.execSync(`PRAGMA user_version = ${v + 1}`);
      db.execSync('COMMIT');
    } catch (e) {
      db.execSync('ROLLBACK');
      throw e;
    }
  }
  return migrations.length;
}
