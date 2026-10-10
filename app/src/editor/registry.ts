import type { EditorDoc } from './doc';

/**
 * Open editing sessions by library item id. Keeping the doc here (not in a component) is what lets undo/redo survive
 * leaving and re-entering the editor. At most MAX docs stay in memory (a 12 MP doc is ~100 MB with its photo).
 */
const MAX_OPEN_DOCS = 2;
const docs = new Map<string, EditorDoc>();

export const sessionKey = (itemId: string | null, sourceUri: string | null): string =>
  itemId ?? `session:${sourceUri ?? 'unsaved'}`;

export function getOpenDoc(key: string): EditorDoc | undefined {
  const d = docs.get(key);
  if (d) {
    docs.delete(key); // refresh recency
    docs.set(key, d);
  }
  return d;
}

export function putOpenDoc(key: string, doc: EditorDoc): void {
  docs.delete(key);
  docs.set(key, doc);
  while (docs.size > MAX_OPEN_DOCS) {
    const oldest = docs.keys().next().value as string;
    docs.get(oldest)?.pyramid.dispose();
    docs.delete(oldest);
  }
}

export function dropOpenDoc(key: string): void {
  docs.get(key)?.pyramid.dispose();
  docs.delete(key);
}

export function clearOpenDocs(): void {
  for (const k of [...docs.keys()]) dropOpenDoc(k);
}

export const openDocCount = (): number => docs.size;
