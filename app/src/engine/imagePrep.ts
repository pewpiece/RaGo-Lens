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

export function cappedSize(width: number, height: number, cap: number): { width: number; height: number } {
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
export async function prepareWorkingImage(uri: string, cap: number, deps: PrepDeps): Promise<PreparedImage> {
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
    return deps.manipulate(first.uri, first.width >= first.height ? { width: cap } : { height: cap });
  }
  return first;
}
