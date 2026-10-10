import { dilate, erode, threshold } from './morph';

/**
 * Edge matting at full resolution. A salient-object model gives a soft mask at 320 to 1024 px; here the narrow
 * uncertain band along the object's edge is resolved against the real photo pixels:
 *
 *   1. trimap: certain foreground (eroded mask), certain background (outside the dilated mask), unknown band between;
 *   2. for each unknown pixel, estimate the local foreground colour F and background colour B from nearby certain
 *      pixels (integral images, O(1) per pixel);
 *   3. alpha from the colour line: a = ((I - B) . (F - B)) / |F - B|^2, trusted in proportion to how different F and B are
 *      (when they are alike, as with a dark product on a dark scene, the model's own alpha is kept);
 *   4. colour decontamination: the true foreground colour C = (I - (1 - a) B) / a replaces the edge pixel, so no halo of
 *      the old background remains.
 *
 * Per-pixel work happens only inside the band, never over the whole image. Callers feed it one tile (plus a margin) at a time.
 */
export interface MatteOptions {
  /** Half the width of the uncertain band, in px. */
  bandRadius: number;
  /** Colour sampling window radius (px). Default 2 * bandRadius + 2. */
  windowRadius?: number;
  /** Minimum certain samples of each kind in the window. */
  minSamples?: number;
  /** |F - B| (RGB units) below which the model's alpha is kept as is; above `trustDistance` the colour-line alpha is used fully. */
  lowContrast?: number;
  trustDistance?: number;
  /** Keep `alpha` exactly as given and only recover edge colours (used at export, after the mask is final). */
  keepAlpha?: boolean;
}

export interface MatteResult {
  alpha: Uint8Array;
  /** RGB (3 bytes per pixel): decontaminated colour where the pixel is in the band and semi-transparent; else the input colour. */
  colour: Uint8Array;
  /** 255 where the pixel was in the uncertain band. */
  band: Uint8Array;
}

/** 0 = background, 128 = unknown, 255 = foreground. */
export function buildTrimap(alpha: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const bin = threshold(alpha, 127);
  const inner = erode(bin, w, h, r);
  const outer = dilate(bin, w, h, r);
  const t = new Uint8Array(w * h);
  for (let i = 0; i < t.length; i++) t[i] = inner[i] ? 255 : outer[i] ? 128 : 0;
  return t;
}

export function refineMatte(
  rgba: Uint8Array,
  alpha: Uint8Array,
  w: number,
  h: number,
  o: MatteOptions,
): MatteResult {
  const n = w * h;
  const R = Math.max(1, Math.round(o.bandRadius));
  const minSamples = o.minSamples ?? 6;
  const low = o.lowContrast ?? 10;
  const high = o.trustDistance ?? 50;
  const trimap = buildTrimap(alpha, w, h, R);

  // integral images (rows w+1): fg r,g,b,count and bg r,g,b,count
  const W1 = w + 1;
  const mk = () => new Float64Array(W1 * (h + 1));
  const fr = mk();
  const fgc = mk();
  const fgG = mk();
  const fgB = mk();
  const br = mk();
  const bgc = mk();
  const bgG = mk();
  const bgB = mk();
  for (let y = 0; y < h; y++) {
    let rf = 0,
      gf = 0,
      bf = 0,
      cf = 0,
      rb = 0,
      gb = 0,
      bb = 0,
      cb = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      if (trimap[i] === 255) {
        rf += rgba[p]!;
        gf += rgba[p + 1]!;
        bf += rgba[p + 2]!;
        cf++;
      } else if (trimap[i] === 0) {
        rb += rgba[p]!;
        gb += rgba[p + 1]!;
        bb += rgba[p + 2]!;
        cb++;
      }
      const a = (y + 1) * W1 + x + 1;
      const u = y * W1 + x + 1;
      fr[a] = fr[u]! + rf;
      fgG[a] = fgG[u]! + gf;
      fgB[a] = fgB[u]! + bf;
      fgc[a] = fgc[u]! + cf;
      br[a] = br[u]! + rb;
      bgG[a] = bgG[u]! + gb;
      bgB[a] = bgB[u]! + bb;
      bgc[a] = bgc[u]! + cb;
    }
  }
  const box = (I: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    I[y1 * W1 + x1]! - I[y0 * W1 + x1]! - I[y1 * W1 + x0]! + I[y0 * W1 + x0]!;

  const outA = alpha.slice();
  const colour = new Uint8Array(n * 3);
  const band = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    colour[i * 3] = rgba[i * 4]!;
    colour[i * 3 + 1] = rgba[i * 4 + 1]!;
    colour[i * 3 + 2] = rgba[i * 4 + 2]!;
  }
  const baseWin = o.windowRadius ?? 2 * R + 2;
  const F = [0, 0, 0];
  const B = [0, 0, 0];
  const est = new Float32Array(n).fill(-1);
  const conf = new Float32Array(n);
  const fgCol = new Float32Array(n * 3);
  const bgCol = new Float32Array(n * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (trimap[i] !== 128) continue;
      band[i] = 255;
      let win = baseWin;
      let ok = false;
      for (let tries = 0; tries < 4 && !ok; tries++, win *= 2) {
        const x0 = Math.max(0, x - win),
          y0 = Math.max(0, y - win);
        const x1 = Math.min(w, x + win + 1),
          y1 = Math.min(h, y + win + 1);
        const cf = box(fgc, x0, y0, x1, y1);
        const cb = box(bgc, x0, y0, x1, y1);
        if (cf >= minSamples && cb >= minSamples) {
          F[0] = box(fr, x0, y0, x1, y1) / cf;
          F[1] = box(fgG, x0, y0, x1, y1) / cf;
          F[2] = box(fgB, x0, y0, x1, y1) / cf;
          B[0] = box(br, x0, y0, x1, y1) / cb;
          B[1] = box(bgG, x0, y0, x1, y1) / cb;
          B[2] = box(bgB, x0, y0, x1, y1) / cb;
          ok = true;
        }
      }
      if (!ok) continue;
      const dr = F[0]! - B[0]!,
        dg = F[1]! - B[1]!,
        db = F[2]! - B[2]!;
      const d2 = dr * dr + dg * dg + db * db;
      const dist = Math.sqrt(d2);
      fgCol[i * 3] = F[0]!;
      fgCol[i * 3 + 1] = F[1]!;
      fgCol[i * 3 + 2] = F[2]!;
      bgCol[i * 3] = B[0]!;
      bgCol[i * 3 + 1] = B[1]!;
      bgCol[i * 3 + 2] = B[2]!;
      conf[i] = Math.min(1, Math.max(0, (dist - low) / Math.max(1, high - low)));
      if (d2 < 1) continue;
      const p = i * 4;
      const a =
        ((rgba[p]! - B[0]!) * dr + (rgba[p + 1]! - B[1]!) * dg + (rgba[p + 2]! - B[2]!) * db) / d2;
      est[i] = Math.min(1, Math.max(0, a));
    }
  }
  // blend the colour-line estimate with the model's alpha according to confidence, then denoise inside the band
  if (o.keepAlpha) {
    // the mask is final: only recover foreground colours for its semi-transparent edge pixels
    for (let i = 0; i < n; i++) {
      if (!band[i] || est[i]! < 0) continue;
      const a = alpha[i]! / 255;
      if (a <= 0.02 || a >= 0.995) continue;
      const p = i * 4;
      for (let k = 0; k < 3; k++) {
        const c = a >= 0.12 ? (rgba[p + k]! - (1 - a) * bgCol[i * 3 + k]!) / a : fgCol[i * 3 + k]!;
        colour[i * 3 + k] = Math.round(Math.min(255, Math.max(0, c)));
      }
    }
    return { alpha: alpha.slice(), colour, band };
  }
  const blended = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (band[i] && est[i]! >= 0)
      blended[i] = conf[i]! * est[i]! + (1 - conf[i]!) * (alpha[i]! / 255);
    else blended[i] = alpha[i]! / 255;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!band[i]) continue;
      let s = 0,
        c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += blended[yy * w + xx]!;
          c++;
        }
      }
      outA[i] = Math.round(Math.min(1, Math.max(0, s / c)) * 255);
    }
  }
  // decontamination: recover the foreground colour of semi-transparent edge pixels
  for (let i = 0; i < n; i++) {
    if (!band[i] || est[i]! < 0) continue;
    const a = outA[i]! / 255;
    if (a <= 0.02 || a >= 0.995) continue;
    const p = i * 4;
    for (let k = 0; k < 3; k++) {
      let c: number;
      if (a >= 0.12) c = (rgba[p + k]! - (1 - a) * bgCol[i * 3 + k]!) / a;
      else c = fgCol[i * 3 + k]!;
      colour[i * 3 + k] = Math.round(Math.min(255, Math.max(0, c)));
    }
  }
  return { alpha: outA, colour, band };
}
