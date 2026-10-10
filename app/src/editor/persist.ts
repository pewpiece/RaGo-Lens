import { ImageFormat } from '@shopify/react-native-skia';
import { DEFAULT_EXPORT_OPTIONS } from '@/export/options';
import { encodePng } from '@/engine/skiaOps';
import { serializeEditState } from '@/edit/editState';
import { replaceItemImages } from '@/library/library';
import { tempName, writeCacheFile } from '@/lib/files';
import { renderExport, renderThumbnail, type SceneInputs } from '@/scene/exportRender';
import type { ResultRow } from '@/db/schema';
import { maskToImage } from '@/mask/maskImage';
import type { EditorDoc } from './doc';
import { decontaminationPatches } from './refine';

/** The scene as it will be exported: refined mask and (optionally) colour-decontaminated edges. */
export function sceneOfDoc(doc: EditorDoc): SceneInputs {
  const mask = doc.finalMask();
  return {
    original: doc.original,
    maskLayer: maskToImage(mask),
    patches: doc.refine.decontaminate ? decontaminationPatches(doc.original, mask) : undefined,
    strokes: [],
    width: doc.width,
    height: doc.height,
  };
}

/**
 * Writes the doc back to the library item: mask (8-bit grey+alpha PNG), full-resolution transparent PNG, thumbnail,
 * edit state, and the photo itself when it was rotated/flipped. The export is re-rendered from original + mask.
 */
export async function saveDoc(doc: EditorDoc, itemId: string): Promise<ResultRow | undefined> {
  const scene = sceneOfDoc(doc);
  const full = await renderExport(scene, {
    ...DEFAULT_EXPORT_OPTIONS,
    autoCrop: false,
    size: 'original',
    background: 'transparent',
  });
  const thumb = await renderThumbnail(scene, 320);
  const edit = { ...doc.edit, maskRevision: doc.edit.maskRevision + 1 };
  const photo = doc.photoChanged ? doc.original.encodeToBytes(ImageFormat.JPEG, 95) : null;
  const row = replaceItemImages(itemId, {
    resultUri: writeCacheFile(tempName('result', 'png'), full.png),
    thumbUri: writeCacheFile(tempName('thumb', 'png'), thumb),
    maskUri: writeCacheFile(tempName('mask', 'png'), encodePng(doc.maskImage())),
    editStateJson: serializeEditState(edit),
    ...(photo
      ? {
          originalUri: writeCacheFile(tempName('orig', 'jpg'), photo),
          width: doc.width,
          height: doc.height,
        }
      : {}),
  });
  doc.edit = edit;
  doc.dirty = false;
  doc.editDirty = false;
  doc.photoChanged = false;
  return row;
}
