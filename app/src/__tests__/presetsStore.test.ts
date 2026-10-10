import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { MIGRATIONS, runMigrations, type MigratableDb } from '@/db/migrations';
import type { SyncDb } from '@/db/kv';
import * as schema from '@/db/schema';
import { SEED_PRESETS, duplicatePreset, parsePreset } from '@/presets/presets';
import { loadPresets, newPresetId, removePreset, savePreset } from '@/presets/store';
import { maskTightBounds } from '@/mask/bounds';
import { TiledMask } from '@/mask/tiledMask';
import { frameSet } from '@/compose/framing';
import { framingStats, placeProduct } from '@/compose/layout';
import { DEFAULT_EDIT_STATE } from '@/edit/editState';

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
  runMigrations(adapter, MIGRATIONS);
  return drizzle(raw, { schema }) as unknown as SyncDb;
}

describe('presets', () => {
  it('seeds the generic presets once, and the user can edit, duplicate and delete them', async () => {
    const db = await makeDb();
    const first = loadPresets(db);
    expect(first.map((p) => p.id)).toEqual(SEED_PRESETS.map((p) => p.id));
    expect(first.length).toBeGreaterThanOrEqual(3);
    // edit one
    const edited = {
      ...first[0]!,
      name: 'My white square',
      fill: { min: 0.8, max: 0.9, target: 0.85 },
      maxFileKB: 700,
    };
    savePreset(db, edited, 0);
    const copy = duplicatePreset(edited, newPresetId());
    savePreset(db, copy, 5);
    let all = loadPresets(db);
    expect(all.find((p) => p.id === edited.id)?.name).toBe('My white square');
    expect(all.find((p) => p.id === edited.id)?.maxFileKB).toBe(700);
    expect(all.find((p) => p.id === copy.id)?.name).toBe('My white square copy');
    // seeding does not overwrite the user's edit when loading again
    expect(loadPresets(db).find((p) => p.id === edited.id)?.name).toBe('My white square');
    removePreset(db, copy.id);
    removePreset(db, first[1]!.id);
    all = loadPresets(db);
    expect(all.some((p) => p.id === copy.id || p.id === first[1]!.id)).toBe(false);
  });

  it('a damaged preset row falls back to safe values instead of crashing', () => {
    const p = parsePreset(
      'x',
      '  ',
      '{"fill":{"min":5,"max":-1},"canvas":{"width":"big"},"format":"gif","shadow":"lava"}',
    );
    expect(p.name).toBe('Untitled preset');
    expect(p.format).toBe('png');
    expect(p.shadow).toBe('none');
    expect(p.fill.max).toBeGreaterThanOrEqual(p.fill.min);
    expect(p.canvas.width).toBe(2000);
    expect(parsePreset('y', 'n', 'not json').background).toEqual({ kind: 'transparent' });
  });
});

describe('tight mask bounds', () => {
  it('finds a 1 px feature on a 12 MP-sized mask without scanning empty tiles', () => {
    const m = new TiledMask(4000, 3000);
    m.writeRegion({ x: 1500, y: 1000, w: 1000, h: 800 }, new Uint8Array(1000 * 800).fill(255));
    m.writeRegion({ x: 2500, y: 1400, w: 1400, h: 1 }, new Uint8Array(1400).fill(200)); // thin crown to the right
    expect(maskTightBounds(m)).toEqual({ left: 1500, top: 1000, right: 3900, bottom: 1800 });
    expect(maskTightBounds(new TiledMask(100, 100))).toBeNull();
    expect(maskTightBounds(new TiledMask(100, 100, 255))).toEqual({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
    });
  });
});

describe('consistent framing across a set', () => {
  it('products of different sizes and shapes get the same fill ratio, centre and baseline', () => {
    const canvas = { w: 2000, h: 2000 };
    const items = [
      { bounds: { left: 0, top: 0, right: 400, bottom: 200 }, rotation: 0 }, // wide
      { bounds: { left: 0, top: 0, right: 150, bottom: 600 }, rotation: 0 }, // tall bottle
      { bounds: { left: 0, top: 0, right: 300, bottom: 300 }, rotation: 30 }, // rotated square
    ];
    const ts = frameSet(items, DEFAULT_EDIT_STATE.transform, canvas, 0.8, { baseline: 0.9 });
    const stats = ts.map((t, i) =>
      framingStats(placeProduct(items[i]!.bounds, t, canvas, 0.8).box, canvas),
    );
    for (const s of stats) {
      expect(s.fill).toBeCloseTo(0.8, 6);
      expect(s.centreOffsetX).toBeCloseTo(0, 9);
      expect(s.marginBottom).toBeCloseTo(0.1, 6); // all stand on the same baseline
    }
  });
});
