import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { MIGRATIONS, runMigrations, type MigratableDb } from '@/db/migrations';
import { memoryKv, sqliteKv, type SyncDb } from '@/db/kv';
import * as repo from '@/db/resultsRepo';
import * as schema from '@/db/schema';

async function makeDb() {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const adapter: MigratableDb = {
    execSync: (sql) => raw.run(sql),
    getFirstSync: <T>(sql: string) => {
      const res = raw.exec(sql)[0];
      if (!res) return null;
      const obj: Record<string, unknown> = {};
      res.columns.forEach((c, i) => (obj[c] = res.values[0]![i]));
      return obj as T;
    },
  };
  const db = drizzle(raw, { schema }) as unknown as SyncDb;
  return { raw, adapter, db };
}

const row = (id: string, createdAt: number) => ({
  id,
  mode: 'cutout',
  originalUri: `file:///o/${id}.jpg`,
  resultUri: `file:///r/${id}.png`,
  thumbUri: `file:///t/${id}.png`,
  width: 100,
  height: 80,
  settingsJson: '{}',
  createdAt,
});

describe('migrations', () => {
  it('creates the schema and sets user_version', async () => {
    const { adapter, raw } = await makeDb();
    expect(runMigrations(adapter)).toBe(MIGRATIONS.length);
    const tables = raw
      .exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0]!
      .values.flat();
    expect(tables).toEqual(expect.arrayContaining(['results', 'settings']));
    expect(
      adapter.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version,
    ).toBe(MIGRATIONS.length);
  });

  it('is idempotent and applies only pending migrations', async () => {
    const { adapter, raw } = await makeDb();
    runMigrations(adapter);
    raw.run("INSERT INTO settings (key, value) VALUES ('a', '1')");
    runMigrations(adapter);
    const extra = [...MIGRATIONS, 'ALTER TABLE results ADD COLUMN note TEXT;'];
    runMigrations(adapter, extra);
    expect(
      adapter.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version,
    ).toBe(2);
    expect(raw.exec('SELECT value FROM settings')[0]!.values[0]![0]).toBe('1');
  });

  it('rolls back a failing migration and leaves the version untouched', async () => {
    const { adapter } = await makeDb();
    runMigrations(adapter);
    expect(() => runMigrations(adapter, [...MIGRATIONS, 'THIS IS NOT SQL'])).toThrow();
    expect(
      adapter.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version,
    ).toBe(MIGRATIONS.length);
  });

  it('refuses a database from a newer app version', async () => {
    const { adapter } = await makeDb();
    runMigrations(adapter);
    expect(() => runMigrations(adapter, [])).toThrow(/newer/);
  });
});

describe('results repo', () => {
  it('inserts, lists newest-first, reads, updates and deletes', async () => {
    const { adapter, db } = await makeDb();
    runMigrations(adapter);
    repo.insertResult(db, row('a', 1));
    repo.insertResult(db, row('b', 3));
    repo.insertResult(db, row('c', 2));
    expect(repo.listResults(db).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(repo.listResults(db, 2).map((r) => r.id)).toEqual(['b', 'c']);
    expect(repo.getResult(db, 'c')?.mode).toBe('cutout');
    repo.updateResultFiles(db, 'c', { resultUri: 'file:///r/new.png' });
    expect(repo.getResult(db, 'c')?.resultUri).toBe('file:///r/new.png');
    repo.deleteResults(db, ['a', 'b']);
    expect(repo.listResults(db).map((r) => r.id)).toEqual(['c']);
    repo.deleteResults(db, []);
    repo.clearResults(db);
    expect(repo.listResults(db)).toEqual([]);
  });
});

describe('key/value storage', () => {
  it('sqlite kv upserts and removes', async () => {
    const { adapter, db } = await makeDb();
    runMigrations(adapter);
    const kv = sqliteKv(db);
    expect(await kv.get('theme')).toBeNull();
    await kv.set('theme', 'dark');
    await kv.set('theme', 'light');
    expect(await kv.get('theme')).toBe('light');
    await kv.remove('theme');
    expect(await kv.get('theme')).toBeNull();
  });

  it('memory kv behaves the same', async () => {
    const kv = memoryKv({ a: '1' });
    expect(await kv.get('a')).toBe('1');
    await kv.set('a', '2');
    expect(await kv.get('a')).toBe('2');
  });
});
