export interface PreparedImage {
  /** EXIF-normalised JPEG at the working size, in app cache. */
  uri: string;
  width: number;
  height: number;
}

/** Scale (<= 1) that fits the long edge into `cap`. */
export function capScale(width: number, height: number, cap: number): number {
  const long = Math.max(width, height);
  return long > cap ? cap / long : 1;
}

export function cappedSize(
  width: number,
  height: number,
  cap: number,
): { width: number; height: number } {
  const s = capScale(width, height, cap);
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

export interface PrepDeps {
  getSize: (uri: string) => Promise<{ width: number; height: number }>;
  /** Re-encodes (applying EXIF rotation) and optionally resizes; returns the new file. */
  manipulate: (
    uri: string,
    resize: { width: number } | { height: number } | null,
  ) => Promise<PreparedImage>;
}

/**
 * Loads the picked/shared/captured photo into a working JPEG: upright, long edge <= cap.
 * Capping early keeps decode memory bounded on low-end phones (a 12 MP photo is never held at full size by us).
 */
export async function prepareWorkingImage(
  uri: string,
  cap: number,
  deps: PrepDeps,
): Promise<PreparedImage> {
  let size: { width: number; height: number } | null = null;
  try {
    size = await deps.getSize(uri);
  } catch {
    size = null;
  }
  if (size && size.width > 0 && size.height > 0) {
    const s = capScale(size.width, size.height, cap);
    if (s < 1) {
      return deps.manipulate(uri, size.width >= size.height ? { width: cap } : { height: cap });
    }
    return deps.manipulate(uri, null);
  }
  // Unknown size: normalise first, then shrink if needed.
  const first = await deps.manipulate(uri, null);
  if (capScale(first.width, first.height, cap) < 1) {
    return deps.manipulate(
      first.uri,
      first.width >= first.height ? { width: cap } : { height: cap },
    );
  }
  return first;
}

/** Photos above this many pixels are scaled down on import (with a visible warning, never silently). */
export const MAX_PHOTO_PIXELS = 24_000_000;

export interface PreparedPhoto {
  /** Upright, full-resolution copy of the photo (the edit session works from this one). */
  original: PreparedImage;
  /** Copy whose long edge is <= the working cap; only the segmentation model sees it. May be the same file. */
  working: PreparedImage;
  /** Set when the photo had to be scaled down to MAX_PHOTO_PIXELS; the pre-scale size. */
  scaledDownFrom?: { width: number; height: number };
}

const longEdgeResize = (w: number, h: number, cap: number) =>
  w >= h ? { width: cap } : { height: cap };

/**
 * Imports a photo for editing: an EXIF-upright full-resolution original (bounded to MAX_PHOTO_PIXELS) plus a
 * smaller working copy for inference. Export size always derives from `original`, never from `working`.
 */
export async function preparePhoto(
  uri: string,
  cap: number,
  deps: PrepDeps,
  maxPixels = MAX_PHOTO_PIXELS,
): Promise<PreparedPhoto> {
  let size: { width: number; height: number } | null = null;
  try {
    size = await deps.getSize(uri);
  } catch {
    size = null;
  }
  let scaledDownFrom: PreparedPhoto['scaledDownFrom'];
  let resize: { width: number } | { height: number } | null = null;
  if (size && size.width > 0 && size.height > 0 && size.width * size.height > maxPixels) {
    const k = Math.sqrt(maxPixels / (size.width * size.height));
    scaledDownFrom = { width: size.width, height: size.height };
    resize = { width: Math.floor(size.width * k) };
  }
  const original = await deps.manipulate(uri, resize);
  if (!scaledDownFrom && original.width * original.height > maxPixels) {
    // size was unknown up front: shrink now and say so
    const k = Math.sqrt(maxPixels / (original.width * original.height));
    scaledDownFrom = { width: original.width, height: original.height };
    const shrunk = await deps.manipulate(original.uri, { width: Math.floor(original.width * k) });
    return finish(shrunk, cap, deps, scaledDownFrom);
  }
  return finish(original, cap, deps, scaledDownFrom);
}

async function finish(
  original: PreparedImage,
  cap: number,
  deps: PrepDeps,
  scaledDownFrom?: PreparedPhoto['scaledDownFrom'],
): Promise<PreparedPhoto> {
  const working =
    capScale(original.width, original.height, cap) < 1
      ? await deps.manipulate(original.uri, longEdgeResize(original.width, original.height, cap))
      : original;
  return { original, working, ...(scaledDownFrom ? { scaledDownFrom } : {}) };
}
