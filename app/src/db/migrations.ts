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
  // v2 (Phase 1.5): full-resolution mask + edit state on results, batch queue, user presets.
  // Existing cut-outs keep working: mask_uri is back-filled from settings_json and the photo size is the old size.
  `ALTER TABLE results ADD COLUMN mask_uri TEXT;
   ALTER TABLE results ADD COLUMN original_width INTEGER;
   ALTER TABLE results ADD COLUMN original_height INTEGER;
   ALTER TABLE results ADD COLUMN edit_state_json TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE results ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
   UPDATE results SET original_width = width, original_height = height,
     mask_uri = json_extract(settings_json, '$.maskUri');
   CREATE TABLE IF NOT EXISTS batches (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     preset_id TEXT,
     status TEXT NOT NULL DEFAULT 'queued',
     options_json TEXT NOT NULL DEFAULT '{}',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS batch_items (
     id TEXT PRIMARY KEY NOT NULL,
     batch_id TEXT NOT NULL,
     position INTEGER NOT NULL,
     source_uri TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     sku TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'queued',
     result_id TEXT,
     error TEXT,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS batch_items_batch_idx ON batch_items (batch_id, position);
   CREATE TABLE IF NOT EXISTS presets (
     id TEXT PRIMARY KEY NOT NULL,
     name TEXT NOT NULL,
     json TEXT NOT NULL,
     builtin INTEGER NOT NULL DEFAULT 0,
     position INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
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
