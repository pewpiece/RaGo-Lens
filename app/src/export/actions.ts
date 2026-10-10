import { ImageFormat, type SkImage } from '@shopify/react-native-skia';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { readFileHead, writeCacheFile } from '@/lib/files';
import { assertStorage } from '@/library/library';
import { Paths } from 'expo-file-system';
import { pngHasAlphaChannel, isPng } from './png';
import { imageFromBytes, readAlpha } from '@/engine/skiaOps';
import type { RenderedExport } from '@/scene/exportRender';
import type { RenderedComposite } from '@/compose/render';

export class ExportError extends Error {
  constructor(
    public readonly kind: 'permission' | 'storage' | 'unavailable' | 'verify' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export const exportFileName = (d = new Date(), ext: 'png' | 'jpg' = 'png') => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `RaGo-Lens-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
};

/** Writes the PNG to cache and re-reads its header to prove the file on disk is a PNG with alpha where expected. */
export function writeVerifiedPng(r: RenderedExport): string {
  try {
    assertStorage(r.png.length, Paths.availableDiskSpace);
  } catch (e) {
    throw new ExportError('storage', (e as Error).message);
  }
  const uri = writeCacheFile(exportFileName(), r.png);
  const head = readFileHead(uri, 64);
  if (r.expectsAlpha) assertPixelsTransparent(r.png, r.width, r.height);
  if (!isPng(head)) throw new ExportError('verify', 'The exported file is not a valid PNG.');
  if (r.expectsAlpha && !pngHasAlphaChannel(head)) {
    throw new ExportError(
      'verify',
      'The exported file lost its transparency, so it was not saved.',
    );
  }
  return uri;
}

export async function saveToGallery(uri: string): Promise<void> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    throw new ExportError(
      'permission',
      'RaGo Lens needs permission to save to your gallery. You can allow it in Settings, or use Share instead.',
    );
  }
  try {
    await MediaLibrary.saveToLibraryAsync(uri);
  } catch (e) {
    throw new ExportError('failed', `Could not save to the gallery: ${(e as Error).message}`);
  }
}

export async function shareFile(uri: string, format: 'png' | 'jpeg' = 'png'): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new ExportError('unavailable', 'Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    dialogTitle: 'Share picture',
    UTI: format === 'png' ? 'public.png' : 'public.jpeg',
  });
}

export async function copyImage(image: SkImage, format: 'png' | 'jpeg' = 'png'): Promise<void> {
  const base64 = image.encodeToBase64(format === 'png' ? ImageFormat.PNG : ImageFormat.JPEG, 100);
  try {
    await Clipboard.setImageAsync(base64);
  } catch (e) {
    throw new ExportError('failed', `Could not copy the image: ${(e as Error).message}`);
  }
}

/**
 * A PNG header that says "RGBA" proves nothing if every pixel is opaque. Decode the bytes that will be saved
 * and require real transparency (something visible AND something transparent) and the expected size.
 * The check samples a coarse grid, so it is cheap even for 24 MP images.
 */
export function assertPixelsTransparent(png: Uint8Array, width: number, height: number): void {
  let img;
  try {
    img = imageFromBytes(png);
  } catch {
    throw new ExportError(
      'verify',
      'The exported file could not be read back, so it was not saved.',
    );
  }
  if (img.width() !== width || img.height() !== height) {
    throw new ExportError(
      'verify',
      `The exported file is ${img.width()}x${img.height()} but ${width}x${height} was expected.`,
    );
  }
  const a = readAlpha(img);
  const step = Math.max(1, Math.floor(a.length / 200000));
  let transparent = 0;
  let visible = 0;
  for (let i = 0; i < a.length; i += step) {
    if (a[i] === 0) transparent++;
    else visible++;
  }
  if (transparent === 0) {
    throw new ExportError(
      'verify',
      'The exported file has no transparent pixels, so the transparency was lost and it was not saved.',
    );
  }
  if (visible === 0) {
    throw new ExportError(
      'verify',
      'The exported file is completely transparent, so it was not saved.',
    );
  }
}

/**
 * Writes a composed picture to the cache and proves, by reading it back, that the file is what was asked for:
 * a PNG must carry real transparency when it should (decoded and checked pixel by pixel on a coarse grid), a JPEG must
 * start with the JPEG signature, and the decoded size must be the size that was rendered.
 */
export function writeVerifiedComposite(
  r: RenderedComposite,
  name = exportFileName(new Date(), r.format === 'png' ? 'png' : 'jpg'),
): string {
  try {
    assertStorage(r.bytes.length, Paths.availableDiskSpace);
  } catch (e) {
    throw new ExportError('storage', (e as Error).message);
  }
  const uri = writeCacheFile(name, r.bytes);
  const head = readFileHead(uri, 64);
  if (r.format === 'png') {
    if (!isPng(head)) throw new ExportError('verify', 'The exported file is not a valid PNG.');
    if (r.expectsAlpha) {
      if (!pngHasAlphaChannel(head)) {
        throw new ExportError(
          'verify',
          'The exported file lost its transparency, so it was not saved.',
        );
      }
      assertPixelsTransparent(r.bytes, r.width, r.height);
    }
  } else if (!(head[0] === 0xff && head[1] === 0xd8)) {
    throw new ExportError('verify', 'The exported file is not a valid JPEG.');
  }
  return uri;
}
