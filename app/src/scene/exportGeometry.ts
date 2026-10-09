import type { ExportOptions } from '@/export/options';
import type { Bounds } from '@/engine/postprocess';

export interface ExportGeometry {
  /** Region of the working image to export, in working-image px. May extend past the image (padding). */
  crop: Bounds;
  /** Scale applied to the crop to reach the output size (<= 1, never upscales). */
  scale: number;
  outWidth: number;
  outHeight: number;
  /** Drop-shadow blur radius in output px (0 when not used). */
  shadowBlur: number;
}

/**
 * Where to crop and how big the output is.
 * - autoCrop: tight object bounds + padding (percent of the longer object side); padding may spill outside the photo.
 * - shadow background adds room for the shadow.
 * - size caps the long edge; never upscales.
 */
export function computeExportGeometry(
  imgW: number,
  imgH: number,
  objectBounds: Bounds | null,
  o: Pick<ExportOptions, 'autoCrop' | 'paddingPercent' | 'size' | 'background'>,
): ExportGeometry {
  let crop: Bounds = { left: 0, top: 0, right: imgW, bottom: imgH };
  if (o.autoCrop && objectBounds) {
    const w = objectBounds.right - objectBounds.left;
    const h = objectBounds.bottom - objectBounds.top;
    const pad = (Math.max(w, h) * o.paddingPercent) / 100;
    const extra = o.background === 'shadow' ? Math.max(w, h) * 0.08 : 0;
    const m = Math.ceil(pad + extra);
    crop = {
      left: Math.floor(objectBounds.left) - m,
      top: Math.floor(objectBounds.top) - m,
      right: Math.ceil(objectBounds.right) + m,
      bottom: Math.ceil(objectBounds.bottom) + m,
    };
  }
  const cw = Math.max(1, crop.right - crop.left);
  const ch = Math.max(1, crop.bottom - crop.top);
  const long = Math.max(cw, ch);
  const scale = o.size === 'original' ? 1 : Math.min(1, o.size / long);
  const outWidth = Math.max(1, Math.round(cw * scale));
  const outHeight = Math.max(1, Math.round(ch * scale));
  return {
    crop,
    scale,
    outWidth,
    outHeight,
    shadowBlur: o.background === 'shadow' ? Math.max(2, Math.max(outWidth, outHeight) * 0.02) : 0,
  };
}
