import { clampPan, fitTransform, type ViewTransform } from '@/scene/viewTransform';

/** Highest zoom: 16 screen px per photo pixel (1600 %), so individual pixels are clearly visible. */
export const MAX_ZOOM = 16;

export const zoomLimits = (fitScale: number): { min: number; max: number } => ({
  min: fitScale,
  max: Math.max(MAX_ZOOM, fitScale * 4),
});

/** Scale at which one photo pixel is one device pixel ("100 %"). */
export const actualScale = (pixelRatio: number): number => 1 / Math.max(1, pixelRatio);

/**
 * Double-tap: when roughly fitted, zoom to 100 % around the tap; otherwise return to fit.
 */
export function toggleFitActual(
  view: ViewTransform,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  tap: { x: number; y: number },
  pixelRatio: number,
): ViewTransform {
  const fit = fitTransform(imgW, imgH, boxW, boxH);
  const actual = Math.max(actualScale(pixelRatio), fit.scale * 1.05);
  const nearFit = view.scale <= fit.scale * 1.15;
  if (!nearFit) return fit;
  const k = actual / view.scale;
  const next = { scale: actual, x: tap.x - (tap.x - view.x) * k, y: tap.y - (tap.y - view.y) * k };
  return clampPan(next, imgW, imgH, boxW, boxH);
}

export interface MiniMap {
  /** Viewport rectangle inside a map of size mapW x mapH, in map px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The visible part of the photo as a rectangle on the mini-map. */
export function miniMapRect(
  view: ViewTransform,
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number,
  mapW: number,
  mapH: number,
): MiniMap {
  const l = Math.max(0, -view.x / view.scale);
  const t = Math.max(0, -view.y / view.scale);
  const r = Math.min(imgW, (boxW - view.x) / view.scale);
  const b = Math.min(imgH, (boxH - view.y) / view.scale);
  const sx = mapW / imgW;
  const sy = mapH / imgH;
  return { x: l * sx, y: t * sy, w: Math.max(2, (r - l) * sx), h: Math.max(2, (b - t) * sy) };
}

/** Tapping the mini-map centres the main view on that point of the photo. */
export function viewFromMiniMap(
  mx: number,
  my: number,
  view: ViewTransform,
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number,
  mapW: number,
  mapH: number,
): ViewTransform {
  const px = (mx / mapW) * imgW;
  const py = (my / mapH) * imgH;
  return clampPan(
    { scale: view.scale, x: boxW / 2 - px * view.scale, y: boxH / 2 - py * view.scale },
    imgW,
    imgH,
    boxW,
    boxH,
  );
}

/** True when the photo does not fill the box at this zoom (the mini-map is only useful when zoomed in). */
export const isZoomedIn = (
  view: ViewTransform,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
) => view.scale > fitTransform(imgW, imgH, boxW, boxH).scale * 1.1;
