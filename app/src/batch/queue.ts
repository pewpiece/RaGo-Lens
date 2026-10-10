import type { SyncDb } from '@/db/kv';
import {
  getBatch,
  insertBatch,
  listBatchItems,
  requeueInterrupted,
  updateBatchItem,
  updateBatchStatus,
  type BatchItemStatus,
} from '@/db/batchRepo';
import type { BatchItemRow, BatchRow } from '@/db/schema';

export const MAX_BATCH_ITEMS = 50;

export interface BatchOptions {
  presetId: string | null;
  /** File naming template: {name} {sku} {index} {preset}. */
  naming: string;
  /** 'centre' or the baseline (fraction of the canvas height) every product stands on. */
  framing: 'centre' | { baseline: number };
  /** SKU = prefix + zero-padded index, when a prefix is given. */
  skuPrefix: string;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  presetId: null,
  naming: '{name}',
  framing: 'centre',
  skuPrefix: '',
};

export function parseBatchOptions(json: string): BatchOptions {
  try {
    const o = JSON.parse(json) as Partial<BatchOptions>;
    const f = o.framing;
    return {
      presetId: typeof o.presetId === 'string' ? o.presetId : null,
      naming: typeof o.naming === 'string' && o.naming.trim() ? o.naming : '{name}',
      framing:
        f && typeof f === 'object' && typeof (f as { baseline: unknown }).baseline === 'number'
          ? { baseline: Math.min(0.98, Math.max(0.5, (f as { baseline: number }).baseline)) }
          : 'centre',
      skuPrefix: typeof o.skuPrefix === 'string' ? o.skuPrefix.slice(0, 24) : '',
    };
  } catch {
    return DEFAULT_BATCH_OPTIONS;
  }
}

export interface NewBatchInput {
  id: string;
  name: string;
  sources: { uri: string; name: string }[];
  options: BatchOptions;
}

/** Creates a batch and its items in one go. At most 50 photos. */
export function createBatch(
  db: SyncDb,
  input: NewBatchInput,
): { batch: BatchRow; items: BatchItemRow[] } {
  if (input.sources.length === 0) throw new Error('Choose at least one photo.');
  if (input.sources.length > MAX_BATCH_ITEMS)
    throw new Error(`A batch holds at most ${MAX_BATCH_ITEMS} photos.`);
  const now = Date.now();
  const batch: BatchRow = {
    id: input.id,
    name: input.name,
    presetId: input.options.presetId,
    status: 'queued',
    optionsJson: JSON.stringify(input.options),
    createdAt: now,
  };
  const pad = String(input.sources.length).length;
  const items: BatchItemRow[] = input.sources.map((s, i) => ({
    id: `${input.id}-${i}`,
    batchId: input.id,
    position: i,
    sourceUri: s.uri,
    name: s.name,
    sku: input.options.skuPrefix
      ? `${input.options.skuPrefix}${String(i + 1).padStart(pad, '0')}`
      : '',
    status: 'queued',
    resultId: null,
    error: null,
    updatedAt: now,
  }));
  insertBatch(db, batch, items);
  return { batch, items };
}

export interface ItemOutcome {
  resultId: string;
  /** Detections or low confidence: a person should look at this one. */
  needsReview: boolean;
}

export interface BatchDeps {
  db: SyncDb;
  processItem(
    item: BatchItemRow,
    ctx: { batch: BatchRow; signal: AbortSignal },
  ): Promise<ItemOutcome>;
  /** 1 or 2: photos processed at the same time (memory is the limit, not speed). */
  concurrency?: number;
  onUpdate?: () => void;
}

export type BatchState = 'queued' | 'running' | 'paused' | 'done' | 'needs_review' | 'failed';

/** The state a batch is in, derived from its items (so it is always consistent with what is persisted). */
export function summarise(
  items: BatchItemRow[],
  running: boolean,
): { state: BatchState; counts: Record<BatchItemStatus, number> } {
  const counts: Record<BatchItemStatus, number> = {
    queued: 0,
    processing: 0,
    done: 0,
    needs_review: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const i of items) counts[i.status as BatchItemStatus]++;
  const open = counts.queued + counts.processing + counts.cancelled;
  const finished = counts.done + counts.needs_review + counts.failed;
  let state: BatchState;
  if (open > 0) state = running ? 'running' : finished === 0 ? 'queued' : 'paused';
  else if (counts.failed > 0) state = 'failed';
  else if (counts.needs_review > 0) state = 'needs_review';
  else state = 'done';
  return { state, counts };
}

/**
 * Runs a persisted queue. Every state change is written to the database before the next step, so killing the app at any
 * moment loses at most the photo being processed: `run` puts interrupted items back in the queue and carries on.
 */
export class BatchRunner {
  private controller: AbortController | null = null;
  private running = false;

  constructor(private readonly deps: BatchDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Processes queued items until none are left, or `cancel()` is called. Resolves when the loop ends. */
  async run(batchId: string): Promise<void> {
    if (this.running) return;
    const { db } = this.deps;
    const batch = getBatch(db, batchId);
    if (!batch) throw new Error('This batch no longer exists.');
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    requeueInterrupted(db, batchId);
    updateBatchStatus(db, batchId, 'running');
    this.deps.onUpdate?.();
    const width = Math.min(2, Math.max(1, this.deps.concurrency ?? 1));
    const worker = async () => {
      for (;;) {
        if (controller.signal.aborted) return;
        const next = listBatchItems(db, batchId).find((i) => i.status === 'queued');
        if (!next) return;
        updateBatchItem(db, next.id, { status: 'processing', error: null });
        this.deps.onUpdate?.();
        try {
          const out = await this.deps.processItem(next, { batch, signal: controller.signal });
          if (controller.signal.aborted) {
            // finished, but the user cancelled meanwhile: keep the result, it is valid
          }
          updateBatchItem(db, next.id, {
            status: out.needsReview ? 'needs_review' : 'done',
            resultId: out.resultId,
          });
        } catch (e) {
          if (controller.signal.aborted) updateBatchItem(db, next.id, { status: 'queued' });
          else
            updateBatchItem(db, next.id, {
              status: 'failed',
              error: e instanceof Error ? e.message : 'Unknown error',
            });
        }
        this.deps.onUpdate?.();
      }
    };
    try {
      await Promise.all(Array.from({ length: width }, worker));
    } finally {
      this.running = false;
      this.controller = null;
      const { state } = summarise(listBatchItems(db, batchId), false);
      updateBatchStatus(db, batchId, state);
      this.deps.onUpdate?.();
    }
  }

  /** Stops after the photos in flight finish aborting; everything unprocessed stays queued and can be resumed. */
  cancel(): void {
    this.controller?.abort();
  }

  /** Puts a failed (or cancelled) item back in the queue. Call `run` again to process it. */
  retry(itemId: string): void {
    updateBatchItem(this.deps.db, itemId, { status: 'queued', error: null });
    this.deps.onUpdate?.();
  }
}
