import type { TextFormat } from './types';

/** Format and layouts stored with a scan; old scans have none (the text opens as it was saved). */
export function parseSavedScan(json: string): {
  format?: TextFormat;
  texts?: Record<TextFormat, string> | null;
} {
  try {
    const o = JSON.parse(json) as { format?: unknown; texts?: Record<string, unknown> };
    const format =
      o.format === 'plain' || o.format === 'paragraphs' || o.format === 'markdown'
        ? o.format
        : undefined;
    const t = o.texts;
    const texts =
      t &&
      typeof t.plain === 'string' &&
      typeof t.paragraphs === 'string' &&
      typeof t.markdown === 'string'
        ? { plain: t.plain, paragraphs: t.paragraphs, markdown: t.markdown }
        : null;
    return { format, texts };
  } catch {
    return {};
  }
}
