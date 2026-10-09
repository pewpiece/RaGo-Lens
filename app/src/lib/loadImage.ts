import { File } from 'expo-file-system';
import type { SkImage } from '@shopify/react-native-skia';
import { imageFromBytes } from '@/engine/skiaOps';

/**
 * Decodes a local image file into a Skia image.
 * Deliberately NOT Skia.Data.fromURI: on Android that never settles when the file cannot be opened, which
 * would leave the UI waiting forever. Reading the bytes ourselves fails fast with a clear error.
 */
export async function loadImage(uri: string): Promise<SkImage> {
  const file = new File(uri);
  if (!file.exists) throw new Error(`Could not load image: file not found (${uri})`);
  return imageFromBytes(await file.bytes());
}
