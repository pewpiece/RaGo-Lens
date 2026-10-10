import { AlphaType, ColorType } from '@shopify/react-native-skia';
import { imageFromBytes } from './skiaOps';
import type { MaskResult } from './types';

/**
 * Reads a mask PNG from the laptop. A PNG with a real alpha channel whose colour channels are all equal is read as alpha
 * (a "transparent cut-out" style mask); anything else is read as greyscale (red channel).
 */
export function decodeMaskPng(png: Uint8Array): MaskResult {
  const img = imageFromBytes(png);
  const w = img.width();
  const h = img.height();
  const px = img.readPixels(0, 0, {
    width: w,
    height: h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!px) throw new Error('Could not read the mask');
  const rgba = px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
  let alphaVaries = false;
  let colourEqual = true;
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] !== 255) alphaVaries = true;
    if (rgba[i * 4] !== rgba[i * 4 + 1] || rgba[i * 4] !== rgba[i * 4 + 2]) colourEqual = false;
  }
  const useAlpha = alphaVaries && colourEqual;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = useAlpha ? rgba[i * 4 + 3]! : rgba[i * 4]!;
  return { alpha, width: w, height: h };
}
