import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const results = sqliteTable(
  'results',
  {
    id: text('id').primaryKey(),
    mode: text('mode').notNull(),
    originalUri: text('original_uri').notNull(),
    resultUri: text('result_uri').notNull(),
    thumbUri: text('thumb_uri').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    settingsJson: text('settings_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
    /** Full-resolution 8-bit mask PNG (cut-outs). */
    maskUri: text('mask_uri'),
    originalWidth: integer('original_width'),
    originalHeight: integer('original_height'),
    /** Non-destructive edit state: mask revision, transform, shadow, background, preset, refinement. */
    editStateJson: text('edit_state_json').notNull().default('{}'),
    /** 'ready' | 'needs_review' */
    status: text('status').notNull().default('ready'),
  },
  (t) => [index('results_created_at_idx').on(t.createdAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const batches = sqliteTable('batches', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  presetId: text('preset_id'),
  status: text('status').notNull().default('queued'),
  optionsJson: text('options_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
});

export const batchItems = sqliteTable(
  'batch_items',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    position: integer('position').notNull(),
    sourceUri: text('source_uri').notNull(),
    name: text('name').notNull().default(''),
    sku: text('sku').notNull().default(''),
    /** queued | processing | done | needs_review | failed | cancelled */
    status: text('status').notNull().default('queued'),
    resultId: text('result_id'),
    error: text('error'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('batch_items_batch_idx').on(t.batchId, t.position)],
);

export const presets = sqliteTable('presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  json: text('json').notNull(),
  builtin: integer('builtin').notNull().default(0),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type BatchRow = typeof batches.$inferSelect;
export type BatchItemRow = typeof batchItems.$inferSelect;
export type PresetRow = typeof presets.$inferSelect;
export type ResultRow = typeof results.$inferSelect;
export type NewResultRow = typeof results.$inferInsert;
