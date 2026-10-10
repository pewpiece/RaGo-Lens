import { drawAsImage, Group, Paint, Rect, Shadow, type SkImage } from '@shopify/react-native-skia';
import { maskBoundsExact, type Bounds } from '@/engine/postprocess';
import { encodePng, readAlpha } from '@/engine/skiaOps';
import { pngHasAlphaChannel } from '@/export/png';
import type { ExportOptions } from '@/export/options';
import { CutoutTree, MaskTree, type PhotoPatchLike } from './CutoutTree';
import { computeExportGeometry, type ExportGeometry } from './exportGeometry';
import type { Stroke } from './strokes';

export interface SceneInputs {
  original: SkImage;
  maskLayer: SkImage;
  strokes: readonly Stroke[];
  /** Colour-decontaminated edge tiles (see editor/refine.ts); optional. */
  patches?: readonly PhotoPatchLike[];
  /** Working-image size in px. */
  width: number;
  height: number;
}

/**
 * Tight bounds (photo px) of the current mask, measured on the full-resolution mask (never a down-scaled
 * probe, which loses thin features such as a watch crown), or null if the mask is empty.
 */
export async function objectBoundsOf(
  s: Pick<SceneInputs, 'maskLayer' | 'strokes' | 'width' | 'height'>,
): Promise<Bounds | null> {
  let layer: SkImage = s.maskLayer;
  if (s.strokes.length > 0) layer = await bakeMask(s);
  return maskBoundsExact(readAlpha(layer), layer.width(), layer.height());
}

export const backgroundColorOf = (o: Pick<ExportOptions, 'background' | 'color'>): string | null =>
  o.background === 'white' ? '#FFFFFF' : o.background === 'color' ? o.color : null;

export interface ExportTreeProps {
  scene: SceneInputs;
  options: Pick<ExportOptions, 'background' | 'color'>;
  geometry: ExportGeometry;
}

/** The exported picture: optional background, then the (optionally shadowed) cut-out, cropped and scaled. */
export function ExportTree({ scene, options, geometry: g }: ExportTreeProps) {
  const bg = backgroundColorOf(options);
  return (
    <Group>
      {bg ? <Rect x={0} y={0} width={g.outWidth} height={g.outHeight} color={bg} /> : null}
      <Group
        transform={[{ scale: g.scale }, { translateX: -g.crop.left }, { translateY: -g.crop.top }]}
      >
        {options.background === 'shadow' ? (
          <Group
            layer={
              <Paint>
                <Shadow
                  dx={0}
                  dy={(g.shadowBlur * 0.4) / g.scale}
                  blur={g.shadowBlur / g.scale}
                  color="rgba(0,0,0,0.38)"
                />
              </Paint>
            }
          >
            <CutoutTree {...scene} />
          </Group>
        ) : (
          <CutoutTree {...scene} />
        )}
      </Group>
    </Group>
  );
}

export interface RenderedExport {
  image: SkImage;
  png: Uint8Array;
  width: number;
  height: number;
  /** Whether the PNG on disk will carry an alpha channel (true for transparent and shadow exports). */
  expectsAlpha: boolean;
}

/** Renders the cut-out with the chosen background/crop/size to a PNG (never JPEG). */
export async function renderExport(
  s: SceneInputs,
  o: ExportOptions,
  knownBounds?: Bounds | null,
): Promise<RenderedExport> {
  const bounds = o.autoCrop
    ? knownBounds !== undefined
      ? knownBounds
      : await objectBoundsOf(s)
    : null;
  const g = computeExportGeometry(s.width, s.height, bounds, o);
  const image = await drawAsImage(<ExportTree scene={s} options={o} geometry={g} />, {
    width: g.outWidth,
    height: g.outHeight,
  });
  if (!image) throw new Error('Out of memory: could not render the export');
  const png = encodePng(image);
  const expectsAlpha = backgroundColorOf(o) === null;
  if (expectsAlpha && !pngHasAlphaChannel(png)) {
    throw new Error(
      'Export check failed: the PNG has no alpha channel, transparency would be lost.',
    );
  }
  return { image, png, width: g.outWidth, height: g.outHeight, expectsAlpha };
}

/** Bakes strokes into a new mask layer image (same size as the working image). */
export async function bakeMask(
  s: Pick<SceneInputs, 'maskLayer' | 'strokes' | 'width' | 'height'>,
): Promise<SkImage> {
  if (s.strokes.length === 0) return s.maskLayer;
  const img = await drawAsImage(
    <MaskTree maskLayer={s.maskLayer} strokes={s.strokes} width={s.width} height={s.height} />,
    { width: s.width, height: s.height },
  );
  if (!img) throw new Error('Out of memory: could not apply your edits');
  return img;
}

/** Small preview PNG for the library grid (transparent, long edge `long`). */
export async function renderThumbnail(s: SceneInputs, long = 320): Promise<Uint8Array> {
  const k = Math.min(1, long / Math.max(s.width, s.height));
  const tw = Math.max(1, Math.round(s.width * k));
  const th = Math.max(1, Math.round(s.height * k));
  const img = await drawAsImage(
    <Group transform={[{ scale: k }]}>
      <CutoutTree {...s} />
    </Group>,
    { width: tw, height: th },
  );
  if (!img) throw new Error('Could not render thumbnail');
  return encodePng(img);
}
