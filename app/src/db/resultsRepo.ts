import { desc, eq, inArray } from 'drizzle-orm';
import type { NewResultRow, ResultRow } from './schema';
import { results } from './schema';
import type { SyncDb } from './kv';

export function insertResult(db: SyncDb, row: NewResultRow): void {
  db.insert(results).values(row).run();
}

export function listResults(db: SyncDb, limit?: number): ResultRow[] {
  const q = db.select().from(results).orderBy(desc(results.createdAt));
  return limit ? q.limit(limit).all() : q.all();
}

export function getResult(db: SyncDb, id: string): ResultRow | undefined {
  return db.select().from(results).where(eq(results.id, id)).get();
}

export function updateResultFiles(
  db: SyncDb,
  id: string,
  patch: Partial<
    Pick<
      ResultRow,
      | 'resultUri'
      | 'thumbUri'
      | 'settingsJson'
      | 'maskUri'
      | 'editStateJson'
      | 'status'
      | 'originalWidth'
      | 'originalHeight'
    >
  >,
): void {
  db.update(results).set(patch).where(eq(results.id, id)).run();
}

export function deleteResults(db: SyncDb, ids: string[]): void {
  if (ids.length === 0) return;
  db.delete(results).where(inArray(results.id, ids)).run();
}

export function clearResults(db: SyncDb): void {
  db.delete(results).run();
}
