import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

const parse = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * A thin strip with a colour ramp along its x axis, drawn stretched by the scene. Used instead of a gradient shader so the same
 * code renders identically on a phone and in the Node test environment, and so the ramp is exact (sRGB interpolation).
 * `alphaFrom` / `alphaTo` are 0..1.
 */
export function rampStrip(
  from: string,
  to: string,
  alphaFrom = 1,
  alphaTo = 1,
  steps = 256,
): SkImage {
  const a = parse(from);
  const b = parse(to);
  // square (rows repeat): a 1 px high image stretched many times over is not reliably replicated by every backend
  const rows = 16;
  const px = new Uint8Array(steps * rows * 4);
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    const al = Math.round(255 * (alphaFrom + (alphaTo - alphaFrom) * t));
    for (let y = 0; y < rows; y++) px.set([r, g, bl, al], (y * steps + i) * 4);
  }
  const img = Skia.Image.MakeImage(
    { width: steps, height: rows, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(px),
    steps * 4,
  );
  if (!img) throw new Error('Could not create a gradient');
  return img;
}
