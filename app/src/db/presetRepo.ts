import { asc, eq } from 'drizzle-orm';
import { presets, type PresetRow } from './schema';
import type { SyncDb } from './kv';

export const listPresetRows = (db: SyncDb): PresetRow[] =>
  db.select().from(presets).orderBy(asc(presets.position), asc(presets.createdAt)).all();

export const getPresetRow = (db: SyncDb, id: string): PresetRow | undefined =>
  db.select().from(presets).where(eq(presets.id, id)).get();

export function upsertPresetRow(db: SyncDb, row: PresetRow): void {
  db.insert(presets)
    .values(row)
    .onConflictDoUpdate({
      target: presets.id,
      set: { name: row.name, json: row.json, position: row.position, updatedAt: row.updatedAt },
    })
    .run();
}

export function deletePresetRow(db: SyncDb, id: string): void {
  db.delete(presets).where(eq(presets.id, id)).run();
}
