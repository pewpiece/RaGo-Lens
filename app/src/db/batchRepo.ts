import { and, asc, eq, inArray } from 'drizzle-orm';
import { batchItems, batches, type BatchItemRow, type BatchRow } from './schema';
import type { SyncDb } from './kv';

export type BatchItemStatus =
  'queued' | 'processing' | 'done' | 'needs_review' | 'failed' | 'cancelled';

export function insertBatch(db: SyncDb, b: BatchRow, items: BatchItemRow[]): void {
  db.insert(batches).values(b).run();
  for (const it of items) db.insert(batchItems).values(it).run();
}

export const getBatch = (db: SyncDb, id: string): BatchRow | undefined =>
  db.select().from(batches).where(eq(batches.id, id)).get();

export const listBatches = (db: SyncDb): BatchRow[] =>
  db.select().from(batches).orderBy(asc(batches.createdAt)).all();

export const listBatchItems = (db: SyncDb, batchId: string): BatchItemRow[] =>
  db
    .select()
    .from(batchItems)
    .where(eq(batchItems.batchId, batchId))
    .orderBy(asc(batchItems.position))
    .all();

export function updateBatchItem(
  db: SyncDb,
  id: string,
  patch: Partial<Pick<BatchItemRow, 'status' | 'resultId' | 'error' | 'name' | 'sku'>>,
): void {
  db.update(batchItems)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(batchItems.id, id))
    .run();
}

export function updateBatchStatus(db: SyncDb, id: string, status: string): void {
  db.update(batches).set({ status }).where(eq(batches.id, id)).run();
}

/** Items stuck in 'processing' (the app was killed mid-run) go back to the queue so the run can resume. */
export function requeueInterrupted(db: SyncDb, batchId: string): number {
  const stuck = db
    .select()
    .from(batchItems)
    .where(and(eq(batchItems.batchId, batchId), eq(batchItems.status, 'processing')))
    .all();
  if (stuck.length === 0) return 0;
  db.update(batchItems)
    .set({ status: 'queued', updatedAt: Date.now() })
    .where(
      inArray(
        batchItems.id,
        stuck.map((s) => s.id),
      ),
    )
    .run();
  return stuck.length;
}

export function deleteBatch(db: SyncDb, id: string): void {
  db.delete(batchItems).where(eq(batchItems.batchId, id)).run();
  db.delete(batches).where(eq(batches.id, id)).run();
}
