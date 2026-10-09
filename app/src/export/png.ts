const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** PNG colour types: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. */
export function pngColorType(bytes: Uint8Array): number | null {
  if (bytes.length < 26) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const isIhdr = bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82;
  return isIhdr ? bytes[25]! : null;
}

/** True if the PNG can carry transparency: alpha colour type (4/6) or a tRNS chunk within the scanned bytes. */
export function pngHasAlphaChannel(bytes: Uint8Array): boolean {
  const ct = pngColorType(bytes);
  if (ct === null) return false;
  if (ct === 4 || ct === 6) return true;
  // walk chunks looking for tRNS before IDAT
  let p = 33;
  while (p + 8 <= bytes.length) {
    const len =
      ((bytes[p]! << 24) | (bytes[p + 1]! << 16) | (bytes[p + 2]! << 8) | bytes[p + 3]!) >>> 0;
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    p += 12 + len;
  }
  return false;
}

export function isPng(bytes: Uint8Array): boolean {
  return pngColorType(bytes) !== null;
}
