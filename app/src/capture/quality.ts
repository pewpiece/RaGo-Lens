/**
 * Quick judgement of a just-taken (or picked) photo on a small copy: is it blurry, is it dark, is the centre of the frame
 * very dark or very light? Used to show a tip before processing. Heuristics with thresholds tuned on synthetic images only.
 */
export interface PhotoQuality {
  /** 99th percentile of the luma gradient (0..255 per pixel): a crisp edge is far above a blurred one. */
  edgeSharpness: number;
  blurry: boolean;
  meanLuma: number;
  centreLuma: number;
  tooDark: boolean;
  centreDark: boolean;
  centreLight: boolean;
  tips: string[];
}

export const BLUR_EDGE_LIMIT = 18;

const lumaAt = (rgba: Uint8Array, i: number) =>
  0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;

export function assessPhoto(rgba: Uint8Array, w: number, h: number): PhotoQuality {
  // gradient magnitude histogram (integer bins) for the 99th percentile
  const hist = new Uint32Array(256);
  let count = 0;
  let sum = 0;
  let cSum = 0;
  let cCount = 0;
  const x0 = Math.floor(w * 0.3);
  const x1 = Math.ceil(w * 0.7);
  const y0 = Math.floor(h * 0.3);
  const y1 = Math.ceil(h * 0.7);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = lumaAt(rgba, i);
      sum += l;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        cSum += l;
        cCount++;
      }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
      const gx = lumaAt(rgba, i + 1) - lumaAt(rgba, i - 1);
      const gy = lumaAt(rgba, i + w) - lumaAt(rgba, i - w);
      hist[Math.min(255, Math.round(Math.hypot(gx, gy) / 2))]++;
      count++;
    }
  let acc = 0;
  let p99 = 0;
  for (let b = 0; b < 256; b++) {
    acc += hist[b]!;
    if (acc >= count * 0.99) {
      p99 = b;
      break;
    }
  }
  const mean = sum / (w * h) / 255;
  const centre = cSum / Math.max(1, cCount) / 255;
  const blurry = p99 < BLUR_EDGE_LIMIT;
  const tooDark = mean < 0.1;
  const centreDark = centre < 0.14;
  const centreLight = centre > 0.9;
  const tips: string[] = [];
  if (blurry)
    tips.push('The photo looks blurry. Hold the phone steady, tap to focus, and retake it.');
  if (tooDark) tips.push('The photo is very dark. Move to better light before you shoot.');
  if (centreDark && !tooDark) tips.push('Dark product? Place it on a light surface.');
  else if (centreDark) tips.push('Dark product? Place it on a light surface and add light.');
  if (centreLight) tips.push('Light product? Place it on a darker surface so the edges stand out.');
  return {
    edgeSharpness: p99,
    blurry,
    meanLuma: mean,
    centreLuma: centre,
    tooDark,
    centreDark,
    centreLight,
    tips,
  };
}
