import { drawAsImage, Group, type SkImage } from '@shopify/react-native-skia';
import { CutoutTree, type PhotoPatchLike } from '@/scene/CutoutTree';
import { boxH, boxW, type Box } from './layout';
import type { ProductInputs } from './ComposeTree';

export interface CutoutSource {
  original: SkImage;
  /** Final (refined) mask at photo size. */
  maskLayer: SkImage;
  patches?: readonly PhotoPatchLike[];
  /** Auto exposure / white balance matrix to apply to the photo, when the user chose to export enhanced. */
  colorMatrix?: readonly number[] | null;
  width: number;
  height: number;
  /** Tight bounds of the mask in photo px. */
  bounds: Box;
}

/**
 * Multiplies photo x mask (with the decontaminated edge patches) at photo resolution, cropped to the product bounds,
 * into one premultiplied RGBA image. Everything after this (rotate, flip, scale, shadow) resamples that image.
 */
export async function buildCutout(src: CutoutSource): Promise<ProductInputs> {
  const w = Math.max(1, Math.ceil(boxW(src.bounds)));
  const h = Math.max(1, Math.ceil(boxH(src.bounds)));
  const cutout = await drawAsImage(
    <Group transform={[{ translateX: -src.bounds.left }, { translateY: -src.bounds.top }]}>
      <CutoutTree
        original={src.original}
        maskLayer={src.maskLayer}
        patches={src.patches}
        colorMatrix={src.colorMatrix}
        strokes={[]}
        width={src.width}
        height={src.height}
      />
    </Group>,
    { width: w, height: h },
  );
  if (!cutout) throw new Error('Out of memory: could not build the cut-out');
  return {
    cutout,
    bounds: { ...src.bounds, right: src.bounds.left + w, bottom: src.bounds.top + h },
  };
}
