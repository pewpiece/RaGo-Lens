import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { MIGRATIONS, runMigrations, type MigratableDb } from '@/db/migrations';
import type { SyncDb } from '@/db/kv';
import * as schema from '@/db/schema';
import * as lib from '@/library/library';
import { saveScanText, saveScanToLibrary } from '@/scan/saveScan';
import type { ScanResult } from '@/scan/pipeline';

jest.mock('expo-file-system', () => require('@/testing/fakeFileSystem').fakeFileSystem());
jest.mock('@/db/client', () => ({ getDb: () => (globalThis as { __db?: unknown }).__db }));

const fs = jest.requireMock('expo-file-system') as {
  File: new (...p: unknown[]) => {
    uri: string;
    create(): void;
    write(b: Uint8Array | string): void;
    text(): Promise<string>;
  };
  __files: Map<string, Uint8Array>;
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

const temp = (name: string) => {
  const f = new fs.File(`file:///cache/${name}`);
  f.create();
  f.write(new Uint8Array(8).fill(1));
  return f.uri;
};

const scan = (): ScanResult => ({
  sourceUri: 'file:///src.jpg',
  workingUri: temp('work.jpg'),
  width: 3000,
  height: 2000,
  markdown: '## Hi',
  plain: 'Hi',
  charCount: 2,
  engineId: 'mlkit',
  script: 'latin',
  foundText: true,
  formatted: { lines: [], markdown: '## Hi', plain: 'Hi', paragraphs: 'Hi', gapCount: 0 },
});

beforeEach(async () => {
  fs.__files.clear();
  await freshDb();
});

describe('scan items in the library', () => {
  it('saves plain text as a .txt file by default', async () => {
    const row = await saveScanToLibrary(scan(), 'Hi', { makeThumb: async () => temp('t.jpg') });
    expect(row.resultUri).toMatch(/-result\.txt$/);
  });

  it('saves the page photo, a markdown file and a thumbnail as a scan item with the right extensions', async () => {
    const row = await saveScanToLibrary(
      scan(),
      '## Hi\n\n- one',
      { makeThumb: async () => temp('t.jpg') },
      'markdown',
    );
    expect(row.mode).toBe('scan');
    expect(row.resultUri).toMatch(/-result\.md$/);
    expect(row.thumbUri).toMatch(/-thumb\.jpg$/);
    expect(row.originalUri).toMatch(/-original\.jpg$/);
    expect(await new fs.File(row.resultUri).text()).toBe('## Hi\n\n- one');
    expect(lib.parseSettings(row.settingsJson)).toMatchObject({
      engine: 'mlkit',
      script: 'latin',
      chars: 2,
      format: 'markdown',
      texts: { plain: 'Hi', paragraphs: 'Hi', markdown: '## Hi' },
    });
    expect(lib.maskUriOf(row)).toBeNull(); // scans have no mask
    expect(lib.listItems().map((r) => r.mode)).toEqual(['scan']);
  });

  it('persists edited text and reads it back', async () => {
    const row = await saveScanToLibrary(scan(), 'v1', { makeThumb: async () => temp('t.jpg') });
    expect(saveScanText(row.id, 'v2 edited')).toBe(true);
    expect(await lib.readItemText(row)).toBe('v2 edited');
    expect(saveScanText('missing', 'x')).toBe(false);
  });

  it('deleting a scan item removes its files', async () => {
    const row = await saveScanToLibrary(scan(), 'v1', { makeThumb: async () => temp('t.jpg') });
    lib.deleteItems([row.id]);
    expect(lib.listItems()).toEqual([]);
    expect([...fs.__files.keys()].filter((k) => k.includes('/library/'))).toEqual([]);
  });
});
