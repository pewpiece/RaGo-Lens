import { ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { sampleRgba } from '@/engine/skiaOps';
import { autoEnhanceMatrix, isIdentity } from './auto';

/** Draws an image through a colour matrix (a Skia colour filter: no per-pixel JavaScript). */
export function applyMatrix(img: SkImage, matrix: number[]): SkImage {
  const surface = Skia.Surface.Make(img.width(), img.height());
  if (!surface) throw new Error('Out of memory: could not allocate drawing surface');
  const p = Skia.Paint();
  p.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix));
  surface.getCanvas().drawImage(img, 0, 0, p);
  surface.flush?.();
  return surface.makeImageSnapshot();
}

export interface EnhanceResult {
  matrix: number[];
  /** The enhanced working copy as JPEG bytes, or null when the matrix is the identity (nothing to do). */
  jpeg: Uint8Array | null;
}

/** Analyses the working copy, builds the matrix for `strength` and renders the enhanced copy. */
export function enhanceWorkingCopy(working: SkImage, strength: number): EnhanceResult {
  const w = Math.max(
    1,
    Math.round(working.width() * Math.min(1, 256 / Math.max(working.width(), working.height()))),
  );
  const h = Math.max(1, Math.round(working.height() * (w / working.width())));
  const matrix = autoEnhanceMatrix(sampleRgba(working, w, h), w, h, strength);
  if (isIdentity(matrix)) return { matrix, jpeg: null };
  const out = applyMatrix(working, matrix).encodeToBytes(ImageFormat.JPEG, 95);
  if (!out) throw new Error('Could not encode the enhanced photo');
  return { matrix, jpeg: out };
}
