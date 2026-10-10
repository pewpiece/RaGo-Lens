import { SEED_PRESETS, parsePreset, presetJson, type Preset } from './presets';
import { deletePresetRow, listPresetRows, upsertPresetRow } from '@/db/presetRepo';
import type { SyncDb } from '@/db/kv';

export const newPresetId = () =>
  `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** All presets, seeding the generic ones the first time (an empty table). The user's edits are never overwritten. */
export function loadPresets(db: SyncDb): Preset[] {
  let rows = listPresetRows(db);
  if (rows.length === 0) {
    const now = Date.now();
    SEED_PRESETS.forEach((p, i) =>
      upsertPresetRow(db, {
        id: p.id,
        name: p.name,
        json: presetJson(p),
        builtin: 1,
        position: i,
        createdAt: now,
        updatedAt: now,
      }),
    );
    rows = listPresetRows(db);
  }
  return rows.map((r) => parsePreset(r.id, r.name, r.json));
}

export function savePreset(db: SyncDb, p: Preset, position = 999): void {
  const now = Date.now();
  upsertPresetRow(db, {
    id: p.id,
    name: p.name,
    json: presetJson(p),
    builtin: 0,
    position,
    createdAt: now,
    updatedAt: now,
  });
}

export const removePreset = (db: SyncDb, id: string): void => deletePresetRow(db, id);
