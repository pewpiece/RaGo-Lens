/** U-2-Net / rembg normalisation constants (ImageNet mean/std). */
export const MODEL_MEAN = [0.485, 0.456, 0.406] as const;
export const MODEL_STD = [0.229, 0.224, 0.225] as const;
export const MODEL_INPUT_SIZE = 320;

/**
 * RGBA bytes (row-major, w*h*4) -> float32 NCHW tensor data [1,3,h,w], following U-2-Net's ToTensorLab:
 * divide by the image's max channel value, then subtract mean and divide by std per channel.
 */
export function rgbaToNchw(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  mean: readonly number[] = MODEL_MEAN,
  std: readonly number[] = MODEL_STD,
): Float32Array {
  const plane = width * height;
  if (rgba.length < plane * 4) throw new Error('rgbaToNchw: buffer is smaller than width*height*4');
  let max = 0;
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    const m = Math.max(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
    if (m > max) max = m;
  }
  const denom = Math.max(max, 1e-6);
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const o = i * 4;
    out[i] = (rgba[o]! / denom - mean[0]!) / std[0]!;
    out[plane + i] = (rgba[o + 1]! / denom - mean[1]!) / std[1]!;
    out[2 * plane + i] = (rgba[o + 2]! / denom - mean[2]!) / std[2]!;
  }
  return out;
}
