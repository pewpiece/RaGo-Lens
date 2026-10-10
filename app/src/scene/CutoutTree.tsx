import {
  BlurMask,
  ColorMatrix,
  FilterMode,
  Group,
  MipmapMode,
  Image as SkiaImage,
  Paint,
  Path,
  Skia,
  type SkImage,
  type SkPath,
} from '@shopify/react-native-skia';
import { softnessBlur, type Stroke } from './strokes';

/** Mip-mapped sampling: a 12 MP photo drawn at a few hundred pixels is filtered, not point-sampled. */
const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear } as const;

const pathCache = new WeakMap<Stroke, SkPath>();

/** Smooth-ish polyline through the stroke's points (a single point becomes a round dot). */
export function strokePath(stroke: Stroke): SkPath {
  const cached = pathCache.get(stroke);
  if (cached) return cached;
  const b = Skia.PathBuilder.Make();
  const pts = stroke.points;
  if (pts.length > 0) {
    b.moveTo(pts[0]!.x, pts[0]!.y);
    if (pts.length === 1) b.lineTo(pts[0]!.x + 0.01, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) b.lineTo(pts[i]!.x, pts[i]!.y);
    if (stroke.shape === 'area') b.close();
  }
  const path = b.build();
  pathCache.set(stroke, path);
  return path;
}

export interface MaskTreeProps {
  maskLayer: SkImage;
  strokes: readonly Stroke[];
  width: number;
  height: number;
}

/** The editable mask: base layer plus brush strokes. Erase removes coverage, restore adds it back. */
export function MaskTree({ maskLayer, strokes, width, height }: MaskTreeProps) {
  return (
    <>
      <SkiaImage image={maskLayer} x={0} y={0} width={width} height={height} sampling={SAMPLING} />
      {strokes.map((s) => (
        <Path
          key={s.id}
          path={strokePath(s)}
          style={s.shape === 'area' ? 'fill' : 'stroke'}
          strokeWidth={s.size}
          strokeCap="round"
          strokeJoin="round"
          color="white"
          blendMode={s.mode === 'erase' ? 'dstOut' : 'srcOver'}
        >
          {s.softness > 0 ? (
            <BlurMask blur={softnessBlur(s.size, s.softness)} style="normal" respectCTM />
          ) : null}
        </Path>
      ))}
    </>
  );
}

export interface PhotoPatchLike {
  image: SkImage;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CutoutTreeProps extends MaskTreeProps {
  original: SkImage;
  /** Opaque tiles drawn over the photo before the mask is applied (colour-decontaminated edges). */
  patches?: readonly PhotoPatchLike[];
  /** Colour matrix applied to the photo (and patches) before the mask: auto exposure / white balance. */
  colorMatrix?: readonly number[] | null;
}

/**
 * The cut-out in image coordinates: original photo whose alpha is multiplied by the mask (DstIn inside an
 * isolated layer). The photo and base mask are never modified; strokes are an overlay on the mask.
 */
export function CutoutTree({
  original,
  patches,
  colorMatrix,
  maskLayer,
  strokes,
  width,
  height,
}: CutoutTreeProps) {
  const photo = (
    <>
      <SkiaImage image={original} x={0} y={0} width={width} height={height} sampling={SAMPLING} />
      {patches?.map((p, i) => (
        <SkiaImage
          key={i}
          image={p.image}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          sampling={SAMPLING}
        />
      ))}
    </>
  );
  return (
    <Group layer>
      {colorMatrix ? (
        <Group
          layer={
            <Paint>
              <ColorMatrix matrix={[...colorMatrix]} />
            </Paint>
          }
        >
          {photo}
        </Group>
      ) : (
        photo
      )}
      <Group layer={<Paint blendMode="dstIn" />}>
        <MaskTree maskLayer={maskLayer} strokes={strokes} width={width} height={height} />
      </Group>
    </Group>
  );
}
