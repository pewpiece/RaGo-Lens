import { DEFAULT_EXPORT_OPTIONS } from '@/export/options';
import type { CutoutResult } from '@/engine/pipeline';
import { renderExport, renderThumbnail, type SceneInputs } from '@/scene/exportRender';
import { tempName, writeCacheFile } from '@/lib/files';
import { encodePng } from '@/engine/skiaOps';
import { saveItem, replaceItemImages } from './library';
import type { ResultRow } from '@/db/schema';

const sceneOf = (r: CutoutResult): SceneInputs => ({
  original: r.original,
  maskLayer: r.maskLayer,
  strokes: [],
  width: r.width,
  height: r.height,
});

/** Render the full-resolution transparent PNG + thumbnail + mask PNG as temp files. */
async function renderFiles(r: CutoutResult) {
  const scene = sceneOf(r);
  const full = await renderExport(scene, {
    ...DEFAULT_EXPORT_OPTIONS,
    autoCrop: false,
    size: 'original',
    background: 'transparent',
  });
  const thumb = await renderThumbnail(scene, 320);
  return {
    resultUri: writeCacheFile(tempName('result', 'png'), full.png),
    thumbUri: writeCacheFile(tempName('thumb', 'png'), thumb),
    maskUri: writeCacheFile(tempName('mask', 'png'), encodePng(r.maskLayer)),
  };
}

/** Saves a freshly processed result to the library (private storage + SQLite). */
export async function saveResultToLibrary(r: CutoutResult, workingCap: number): Promise<ResultRow> {
  const files = await renderFiles(r);
  return saveItem({
    mode: 'cutout',
    originalUri: r.workingUri,
    ...files,
    width: r.width,
    height: r.height,
    settings: { engine: r.engineId, workingCap },
  });
}

/** After Refine: re-render and replace the stored images of an existing item. */
export async function updateLibraryItem(
  itemId: string,
  r: CutoutResult,
): Promise<ResultRow | undefined> {
  return replaceItemImages(itemId, await renderFiles(r));
}
