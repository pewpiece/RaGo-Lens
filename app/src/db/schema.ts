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
  },
  (t) => [index('results_created_at_idx').on(t.createdAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type ResultRow = typeof results.$inferSelect;
export type NewResultRow = typeof results.$inferInsert;
