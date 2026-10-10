import * as ImageManipulator from 'expo-image-manipulator';
import { loadImage } from '@/lib/loadImage';
import { sampleRgba } from '@/engine/skiaOps';
import { assessPhoto, type PhotoQuality } from './quality';

const EDGE = 256;

/**
 * Looks at a just-taken or picked photo on a 256 px copy. Returns null when it cannot (the caller then simply carries on:
 * a tip is never a reason to block the photo).
 */
export async function assessUri(uri: string): Promise<PhotoQuality | null> {
  try {
    const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: EDGE } }], {
      compress: 0.8,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const img = await loadImage(small.uri);
    const w = img.width();
    const h = img.height();
    return assessPhoto(sampleRgba(img, w, h), w, h);
  } catch {
    return null;
  }
}
