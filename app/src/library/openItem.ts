import { loadImage } from '@/lib/loadImage';
import type { CutoutResult } from '@/engine/pipeline';
import type { ResultRow } from '@/db/schema';
import { maskUriOf } from './library';

/** Loads a library item back into memory as a CutoutResult (non-destructive: photo + mask layer). */
export async function loadItem(row: ResultRow): Promise<CutoutResult> {
  const original = await loadImage(row.originalUri);
  const maskUri = maskUriOf(row);
  let maskLayer;
  try {
    if (!maskUri) throw new Error('no mask file');
    maskLayer = await loadImage(maskUri);
  } catch {
    // Older/damaged items: the result PNG's alpha channel is equivalent to the mask.
    maskLayer = await loadImage(row.resultUri);
  }
  return {
    sourceUri: row.originalUri,
    workingUri: row.originalUri,
    width: row.width,
    height: row.height,
    original,
    maskLayer,
    maskUri: maskUri ?? row.resultUri,
    engineId: 'library',
    foundObject: true,
  };
}
