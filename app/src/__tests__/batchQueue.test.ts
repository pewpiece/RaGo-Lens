import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { MIGRATIONS, runMigrations } from '@/db/migrations';
import type { SyncDb } from '@/db/kv';
import * as schema from '@/db/schema';
import { listBatchItems } from '@/db/batchRepo';
import {
  BatchRunner,
  DEFAULT_BATCH_OPTIONS,
  MAX_BATCH_ITEMS,
  createBatch,
  parseBatchOptions,
  summarise,
} from '@/batch/queue';

async function makeDb() {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  runMigrations(
    {
      execSync: (sql) => raw.run(sql),
      getFirstSync: <T>(sql: string) => {
        const r = raw.exec(sql)[0];
        if (!r) return null;
        const o: Record<string, unknown> = {};
        r.columns.forEach((c, i) => (o[c] = r.values[0]![i]));
        return o as T;
      },
    },
    MIGRATIONS,
  );
  return drizzle(raw, { schema }) as unknown as SyncDb;
}

const sources = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ uri: `file:///p${i}.jpg`, name: `photo-${i}` }));
const statuses = (db: SyncDb, id: string) => listBatchItems(db, id).map((i) => i.status);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('batch queue', () => {
  it('creates up to 50 items with SKUs, and refuses 0 or 51', async () => {
    const db = await makeDb();
    const { items } = createBatch(db, {
      id: 'b1',
      name: 'Spring',
      sources: sources(12),
      options: { ...DEFAULT_BATCH_OPTIONS, skuPrefix: 'SH-' },
    });
    expect(items.map((i) => i.sku).slice(0, 3)).toEqual(['SH-01', 'SH-02', 'SH-03']);
    expect(items[11]!.sku).toBe('SH-12');
    expect(() =>
      createBatch(db, {
        id: 'b2',
        name: 'x',
        sources: sources(MAX_BATCH_ITEMS + 1),
        options: DEFAULT_BATCH_OPTIONS,
      }),
    ).toThrow(/at most 50/);
    expect(() =>
      createBatch(db, { id: 'b3', name: 'x', sources: [], options: DEFAULT_BATCH_OPTIONS }),
    ).toThrow();
    expect(
      createBatch(db, {
        id: 'b4',
        name: 'x',
        sources: sources(MAX_BATCH_ITEMS),
        options: DEFAULT_BATCH_OPTIONS,
      }).items,
    ).toHaveLength(50);
  });

  it('processes in order, flags items needing review, records failures, and reports a derived state', async () => {
    const db = await makeDb();
    createBatch(db, { id: 'b', name: 'n', sources: sources(5), options: DEFAULT_BATCH_OPTIONS });
    const order: string[] = [];
    let failOnce = true;
    const runner = new BatchRunner({
      db,
      processItem: async (item) => {
        order.push(item.name);
        if (item.name === 'photo-1' && failOnce) {
          failOnce = false;
          throw new Error('Could not read this photo');
        }
        return { resultId: `r-${item.name}`, needsReview: item.name === 'photo-3' };
      },
    });
    await runner.run('b');
    expect(order).toEqual(['photo-0', 'photo-1', 'photo-2', 'photo-3', 'photo-4']);
    expect(statuses(db, 'b')).toEqual(['done', 'failed', 'done', 'needs_review', 'done']);
    const items = listBatchItems(db, 'b');
    expect(items[1]!.error).toBe('Could not read this photo');
    expect(items[3]!.resultId).toBe('r-photo-3');
    expect(summarise(items, false).state).toBe('failed');
    // retry the failed one
    runner.retry(items[1]!.id);
    await runner.run('b');
    expect(statuses(db, 'b')[1]).toBe('done'); // it works the second time
  });

  it('runs one or two photos at a time, never more', async () => {
    for (const concurrency of [1, 2]) {
      const db = await makeDb();
      createBatch(db, {
        id: `c${concurrency}`,
        name: 'n',
        sources: sources(6),
        options: DEFAULT_BATCH_OPTIONS,
      });
      let live = 0;
      let peak = 0;
      const runner = new BatchRunner({
        db,
        concurrency,
        processItem: async (item) => {
          live++;
          peak = Math.max(peak, live);
          await sleep(8);
          live--;
          return { resultId: item.id, needsReview: false };
        },
      });
      await runner.run(`c${concurrency}`);
      expect(peak).toBe(concurrency);
      expect(statuses(db, `c${concurrency}`).every((s) => s === 'done')).toBe(true);
    }
    // asking for 5 is capped at 2
    const db = await makeDb();
    createBatch(db, { id: 'c5', name: 'n', sources: sources(6), options: DEFAULT_BATCH_OPTIONS });
    let live = 0;
    let peak = 0;
    await new BatchRunner({
      db,
      concurrency: 5,
      processItem: async (i) => {
        live++;
        peak = Math.max(peak, live);
        await sleep(5);
        live--;
        return { resultId: i.id, needsReview: false };
      },
    }).run('c5');
    expect(peak).toBe(2);
  });

  it('cancel stops after the current photos, leaves the rest queued, and a later run finishes them', async () => {
    const db = await makeDb();
    createBatch(db, { id: 'x', name: 'n', sources: sources(5), options: DEFAULT_BATCH_OPTIONS });
    let runner!: BatchRunner;
    let calls = 0;
    runner = new BatchRunner({
      db,
      processItem: async (item, { signal }) => {
        calls++;
        if (calls === 2) {
          runner.cancel();
          await sleep(5);
          if (signal.aborted) throw new Error('aborted'); // a real engine would throw here
        }
        return { resultId: item.id, needsReview: false };
      },
    });
    await runner.run('x');
    expect(statuses(db, 'x')).toEqual(['done', 'queued', 'queued', 'queued', 'queued']); // the interrupted one is back in the queue
    expect(summarise(listBatchItems(db, 'x'), false).state).toBe('paused');
    await new BatchRunner({
      db,
      processItem: async (i) => ({ resultId: i.id, needsReview: false }),
    }).run('x');
    expect(statuses(db, 'x').every((s) => s === 'done')).toBe(true);
  });

  it('survives a simulated app kill: items left "processing" are re-queued and the batch resumes', async () => {
    const db = await makeDb();
    createBatch(db, { id: 'k', name: 'n', sources: sources(4), options: DEFAULT_BATCH_OPTIONS });
    // first "process": die in the middle of the 2nd photo (the promise never settles; the runner is simply abandoned)
    let n = 0;
    const dying = new BatchRunner({
      db,
      processItem: (item) => {
        n++;
        if (n === 2) return new Promise(() => {}); // the app is killed here
        return Promise.resolve({ resultId: item.id, needsReview: false });
      },
    });
    void dying.run('k');
    await sleep(30);
    expect(statuses(db, 'k')).toEqual(['done', 'processing', 'queued', 'queued']); // exactly what is on disk after the kill
    // "restart": a brand new runner on the same database
    const done: string[] = [];
    await new BatchRunner({
      db,
      processItem: async (item) => {
        done.push(item.name);
        return { resultId: item.id, needsReview: false };
      },
    }).run('k');
    expect(done).toEqual(['photo-1', 'photo-2', 'photo-3']);
    expect(statuses(db, 'k')).toEqual(['done', 'done', 'done', 'done']);
  });

  it('parses stored options defensively', () => {
    expect(
      parseBatchOptions(
        '{"presetId":"p","naming":"{sku}_{index}","framing":{"baseline":0.9},"skuPrefix":"A"}',
      ),
    ).toEqual({
      presetId: 'p',
      naming: '{sku}_{index}',
      framing: { baseline: 0.9 },
      skuPrefix: 'A',
    });
    expect(parseBatchOptions('garbage')).toEqual(DEFAULT_BATCH_OPTIONS);
    expect(parseBatchOptions('{"framing":{"baseline":5}}').framing).toEqual({ baseline: 0.98 });
  });
});
