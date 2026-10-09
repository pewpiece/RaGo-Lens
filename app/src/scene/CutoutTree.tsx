import {
  BlurMask,
  Group,
  Image as SkiaImage,
  Paint,
  Path,
  Skia,
  type SkImage,
  type SkPath,
} from '@shopify/react-native-skia';
import { softnessBlur, type Stroke } from './strokes';

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
      <SkiaImage image={maskLayer} x={0} y={0} width={width} height={height} />
      {strokes.map((s) => (
        <Path
          key={s.id}
          path={strokePath(s)}
          style="stroke"
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

export interface CutoutTreeProps extends MaskTreeProps {
  original: SkImage;
}

/**
 * The cut-out in image coordinates: original photo whose alpha is multiplied by the mask (DstIn inside an
 * isolated layer). The photo and base mask are never modified; strokes are an overlay on the mask.
 */
export function CutoutTree({ original, maskLayer, strokes, width, height }: CutoutTreeProps) {
  return (
    <Group layer>
      <SkiaImage image={original} x={0} y={0} width={width} height={height} />
      <Group layer={<Paint blendMode="dstIn" />}>
        <MaskTree maskLayer={maskLayer} strokes={strokes} width={width} height={height} />
      </Group>
    </Group>
  );
}
