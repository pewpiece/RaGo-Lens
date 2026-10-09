import { ImageFormat, type SkImage } from '@shopify/react-native-skia';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { readFileHead, tempName, writeCacheFile } from '@/lib/files';
import { assertStorage, estimatePngBytes } from '@/library/library';
import { Paths } from 'expo-file-system';
import { pngHasAlphaChannel, isPng } from './png';
import type { RenderedExport } from '@/scene/exportRender';

export class ExportError extends Error {
  constructor(
    public readonly kind: 'permission' | 'storage' | 'unavailable' | 'verify' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export const exportFileName = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `RaGo-Lens-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
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

export async function shareFile(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new ExportError('unavailable', 'Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    dialogTitle: 'Share cut-out',
    UTI: 'public.png',
  });
}

export async function copyImage(image: SkImage): Promise<void> {
  const base64 = image.encodeToBase64(ImageFormat.PNG, 100);
  try {
    await Clipboard.setImageAsync(base64);
  } catch (e) {
    throw new ExportError('failed', `Could not copy the image: ${(e as Error).message}`);
  }
}

export { estimatePngBytes, tempName };
