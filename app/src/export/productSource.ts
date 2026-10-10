import type { SkImage } from '@shopify/react-native-skia';
import { buildCutout } from '@/compose/cutout';
import type { ProductInputs } from '@/compose/ComposeTree';
import type { Box } from '@/compose/layout';
import type { ResultRow } from '@/db/schema';
import { parseEditState, type EditState } from '@/edit/editState';
import type { EditorDoc } from '@/editor/doc';
import {
  decontaminationPatches,
  isDefaultRefine,
  refineMask,
  type PhotoPatch,
} from '@/editor/refine';
import { loadImage } from '@/lib/loadImage';
import { maskUriOf } from '@/library/library';
import { maskFromImage, maskToImage } from '@/mask/maskImage';
import { maskTightBounds } from '@/mask/bounds';
import type { TiledMask } from '@/mask/tiledMask';

/**
 * Everything the export needs about one product: the full-resolution photo, the final (refined) mask, the edit state.
 * It comes from an open editor document or is loaded from a library item, so export, batch and the editor share one path.
 */
export interface ProductSource {
  original: SkImage;
  /** The mask as it will be exported (refinement settings already applied). */
  mask: TiledMask;
  width: number;
  height: number;
  edit: EditState;
  patches?: PhotoPatch[];
  bounds: Box | null;
}

export function sourceFromParts(
  original: SkImage,
  baseMask: TiledMask,
  edit: EditState,
): ProductSource {
  const mask = isDefaultRefine(edit.refine)
    ? baseMask
    : refineMask(original, baseMask, edit.refine);
  return {
    original,
    mask,
    width: original.width(),
    height: original.height(),
    edit,
    patches: edit.refine.decontaminate ? decontaminationPatches(original, mask) : undefined,
    bounds: maskTightBounds(mask),
  };
}

export function sourceFromDoc(doc: EditorDoc): ProductSource {
  const mask = doc.finalMask();
  return {
    original: doc.original,
    mask,
    width: doc.width,
    height: doc.height,
    edit: doc.edit,
    patches: doc.refine.decontaminate ? decontaminationPatches(doc.original, mask) : undefined,
    bounds: maskTightBounds(mask),
  };
}

/** Loads a library item's files into a ProductSource. Throws a readable error when a file is missing. */
export async function loadSourceFromRow(row: ResultRow): Promise<ProductSource> {
  const original = await loadImage(row.originalUri);
  const maskUri = maskUriOf(row);
  if (!maskUri) throw new Error('This item has no saved cut-out mask.');
  const mask = maskFromImage(await loadImage(maskUri));
  return sourceFromParts(original, mask, parseEditState(row.editStateJson));
}

/** Multiplies photo x mask once, at photo resolution (premultiplied), ready for any number of compositions. */
export async function toProductInputs(src: ProductSource): Promise<ProductInputs> {
  if (!src.bounds) throw new Error('There is nothing in the cut-out to export.');
  return buildCutout({
    original: src.original,
    maskLayer: maskToImage(src.mask),
    patches: src.patches,
    width: src.width,
    height: src.height,
    bounds: src.bounds,
  });
}
