import { File, Paths } from 'expo-file-system';

/** Writes bytes to a uniquely named file in the app cache and returns its file:// URI. */
export function writeCacheFile(name: string, bytes: Uint8Array): string {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}

export function readFileHead(uri: string, length: number): Uint8Array {
  const file = new File(uri);
  const handle = file.open();
  try {
    return handle.readBytes(length);
  } finally {
    handle.close();
  }
}

export function removeFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

export const tempName = (prefix: string, ext: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.${ext}`;
