import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { MIGRATIONS, runMigrations, type MigratableDb } from '@/db/migrations';
import type { SyncDb } from '@/db/kv';
import * as schema from '@/db/schema';
import * as lib from '@/library/library';

jest.mock('expo-file-system', () => require('@/testing/fakeFileSystem').fakeFileSystem());
jest.mock('@/db/client', () => ({ getDb: () => (globalThis as { __db?: unknown }).__db }));

const fs = jest.requireMock('expo-file-system') as {
  File: new (...p: unknown[]) => {
    uri: string;
    exists: boolean;
    write(b: Uint8Array): void;
    create(): void;
  };
  __files: Map<string, Uint8Array>;
  __state: { available: number };
};

async function freshDb() {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const adapter: MigratableDb = {
    execSync: (sql) => raw.run(sql),
    getFirstSync: <T>(sql: string) => {
      const res = raw.exec(sql)[0];
      if (!res) return null;
      const o: Record<string, unknown> = {};
      res.columns.forEach((c, i) => (o[c] = res.values[0]![i]));
      return o as T;
    },
  };
  runMigrations(adapter, MIGRATIONS);
  (globalThis as { __db?: unknown }).__db = drizzle(raw, { schema }) as unknown as SyncDb;
}

const temp = (name: string, bytes = 8) => {
  const f = new fs.File(`file:///cache/${name}`);
  f.create();
  f.write(new Uint8Array(bytes).fill(7));
  return f.uri;
};
const item = (): lib.NewItem => ({
  mode: 'cutout',
  originalUri: temp('orig.jpg'),
  resultUri: temp('res.png', 100),
  thumbUri: temp('thumb.png'),
  maskUri: temp('mask.png'),
  width: 10,
  height: 8,
  settings: { engine: 'x', workingCap: 2048 },
});

beforeEach(async () => {
  fs.__files.clear();
  fs.__state.available = 10 * 1024 * 1024 * 1024;
  await freshDb();
});

describe('library storage (fake filesystem, real SQLite)', () => {
  it('saveItem moves/copies all files into private storage and records the row', () => {
    const i = item();
    const row = lib.saveItem(i);
    expect(row.resultUri).toMatch(/^file:\/\/\/docs\/library\/.*-result\.png$/);
    for (const u of [row.originalUri, row.resultUri, row.thumbUri, lib.maskUriOf(row)!]) {
      expect(fs.__files.has(u)).toBe(true);
    }
    expect(fs.__files.has(i.resultUri)).toBe(false); // moved
    expect(fs.__files.has(i.thumbUri)).toBe(false);
    expect(fs.__files.has(i.maskUri!)).toBe(false);
    expect(fs.__files.has(i.originalUri)).toBe(true); // original is copied, source kept
    expect(lib.listItems().map((r) => r.id)).toEqual([row.id]);
    expect(lib.parseSettings(row.settingsJson)).toMatchObject({ engine: 'x', workingCap: 2048 });
  });

  it('refuses to save when storage is low and leaves nothing behind', () => {
    fs.__state.available = 1024; // far below the headroom
    expect(() => lib.saveItem(item())).toThrow(lib.LowStorageError);
    expect(lib.listItems()).toEqual([]);
    expect([...fs.__files.keys()].filter((k) => k.includes('/library/'))).toEqual([]);
  });

  it('cleans up partial files when a step fails', () => {
    const i = item();
    fs.__files.delete(i.thumbUri); // thumb vanished => move fails
    expect(() => lib.saveItem(i)).toThrow();
    expect(lib.listItems()).toEqual([]);
    expect([...fs.__files.keys()].filter((k) => k.includes('/library/'))).toEqual([]);
  });

  it('replaceItemImages swaps result/thumb/mask and removes the old files', () => {
    const row = lib.saveItem(item());
    const oldMask = lib.maskUriOf(row)!;
    const updated = lib.replaceItemImages(row.id, {
      resultUri: temp('res2.png', 50),
      thumbUri: temp('thumb2.png'),
      maskUri: temp('mask2.png'),
    })!;
    expect(updated.resultUri).not.toBe(row.resultUri);
    expect(fs.__files.has(row.resultUri)).toBe(false);
    expect(fs.__files.has(oldMask)).toBe(false);
    expect(fs.__files.has(updated.resultUri)).toBe(true);
    expect(fs.__files.has(lib.maskUriOf(updated)!)).toBe(true);
    expect(lib.parseSettings(updated.settingsJson).engine).toBe('x'); // other settings preserved
    expect(
      lib.replaceItemImages('nope', { resultUri: '', thumbUri: '', maskUri: '' }),
    ).toBeUndefined();
  });

  it('deleteItems removes rows and every file; clearLibrary removes everything', () => {
    const a = lib.saveItem(item());
    const b = lib.saveItem(item());
    lib.deleteItems([a.id]);
    expect(lib.listItems().map((r) => r.id)).toEqual([b.id]);
    expect(fs.__files.has(a.resultUri)).toBe(false);
    expect(fs.__files.has(lib.maskUriOf(a)!)).toBe(false);
    expect(fs.__files.has(b.resultUri)).toBe(true);
    lib.clearLibrary();
    expect(lib.listItems()).toEqual([]);
    expect([...fs.__files.keys()].filter((k) => k.includes('/library/'))).toEqual([]);
  });

  it('maskUriOf tolerates missing or corrupt settings', () => {
    expect(lib.maskUriOf({ settingsJson: '{}' })).toBeNull();
    expect(lib.maskUriOf({ settingsJson: 'not json' })).toBeNull();
  });
});
