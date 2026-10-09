import { Directory, File, Paths } from 'expo-file-system';
import { getDb } from '@/db/client';
import type { SyncDb } from '@/db/kv';
import * as repo from '@/db/resultsRepo';
import type { ResultRow } from '@/db/schema';
import type { ModeId } from '@/modes/registry';

/** Extra headroom (bytes) we want free on top of the file we are about to write. */
export const STORAGE_HEADROOM = 50 * 1024 * 1024;

export class LowStorageError extends Error {
  constructor(
    public readonly needed: number,
    public readonly available: number,
  ) {
    super('Not enough free storage to save this result. Free up some space and try again.');
    this.name = 'LowStorageError';
  }
}

/** Rough upper bound for a PNG of the given size (RGBA, mild compression). */
export const estimatePngBytes = (w: number, h: number) => Math.round(w * h * 4 * 0.6);

export function assertStorage(neededBytes: number, availableBytes: number) {
  if (availableBytes < neededBytes + STORAGE_HEADROOM) {
    throw new LowStorageError(neededBytes, availableBytes);
  }
}

const db = () => getDb() as unknown as SyncDb;

function libraryDir(): Directory {
  const dir = new Directory(Paths.document, 'library');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function listItems(limit?: number): ResultRow[] {
  return repo.listResults(db(), limit);
}

export function getItem(id: string): ResultRow | undefined {
  return repo.getResult(db(), id);
}

export interface NewItem {
  mode: ModeId;
  /** Source image (any readable URI); copied into private storage. */
  originalUri: string;
  /** Full-resolution transparent PNG produced by the pipeline (temp file); moved into storage. */
  resultUri: string;
  /** Small PNG preview (temp file); moved into storage. */
  thumbUri: string;
  /** Mask layer PNG (temp file); moved into storage so the item can be refined again later. */
  maskUri: string;
  width: number;
  height: number;
  settings: Record<string, unknown>;
}

function moveInto(dir: Directory, srcUri: string, name: string, copy = false): string {
  const src = new File(srcUri);
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  if (copy) src.copy(dest);
  else src.move(dest);
  return dest.uri;
}

export function saveItem(item: NewItem): ResultRow {
  const resultSize = new File(item.resultUri).size;
  assertStorage(resultSize * 2, Paths.availableDiskSpace);
  const id = newId();
  const dir = libraryDir();
  const row: ResultRow = {
    id,
    mode: item.mode,
    originalUri: '',
    resultUri: '',
    thumbUri: '',
    width: item.width,
    height: item.height,
    settingsJson: JSON.stringify(item.settings),
    createdAt: Date.now(),
  };
  try {
    row.originalUri = moveInto(dir, item.originalUri, `${id}-original.jpg`, true);
    row.resultUri = moveInto(dir, item.resultUri, `${id}-result.png`);
    row.thumbUri = moveInto(dir, item.thumbUri, `${id}-thumb.png`);
    const maskUri = moveInto(dir, item.maskUri, `${id}-mask.png`);
    row.settingsJson = JSON.stringify({ ...item.settings, maskUri }); // set early so cleanup can find it
    repo.insertResult(db(), row);
  } catch (e) {
    removeFiles(row);

    throw e;
  }
  return row;
}

/** Replace the stored result/thumb of an existing item (e.g. after a refine). */
export function replaceItemImages(
  id: string,
  files: { resultUri: string; thumbUri: string; maskUri: string },
): ResultRow | undefined {
  const row = repo.getResult(db(), id);
  if (!row) return undefined;
  const dir = libraryDir();
  const stamp = Date.now().toString(36);
  const resultNew = moveInto(dir, files.resultUri, `${id}-result-${stamp}.png`);
  const thumbNew = moveInto(dir, files.thumbUri, `${id}-thumb-${stamp}.png`);
  const maskNew = moveInto(dir, files.maskUri, `${id}-mask-${stamp}.png`);
  const old = parseSettings(row.settingsJson);
  safeDelete(row.resultUri);
  safeDelete(row.thumbUri);
  safeDelete(typeof old.maskUri === 'string' ? old.maskUri : '');
  repo.updateResultFiles(db(), id, {
    resultUri: resultNew,
    thumbUri: thumbNew,
    settingsJson: JSON.stringify({ ...old, maskUri: maskNew }),
  });
  return repo.getResult(db(), id);
}

export function parseSettings(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const maskUriOf = (row: Pick<ResultRow, 'settingsJson'>): string | null => {
  const m = parseSettings(row.settingsJson).maskUri;
  return typeof m === 'string' && m ? m : null;
};

function safeDelete(uri: string) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

function removeFiles(
  row: Pick<ResultRow, 'originalUri' | 'resultUri' | 'thumbUri' | 'settingsJson'>,
) {
  safeDelete(row.originalUri);
  safeDelete(row.resultUri);
  safeDelete(row.thumbUri);
  safeDelete(maskUriOf(row) ?? '');
}

export function deleteItems(ids: string[]): void {
  for (const id of ids) {
    const row = repo.getResult(db(), id);
    if (row) removeFiles(row);
  }
  repo.deleteResults(db(), ids);
}

export function clearLibrary(): void {
  for (const row of repo.listResults(db())) removeFiles(row);
  repo.clearResults(db());
  try {
    const dir = new Directory(Paths.document, 'library');
    if (dir.exists) dir.delete();
  } catch {
    /* leave it */
  }
}
