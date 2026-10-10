import type { BackgroundState, TransformState } from '@/edit/editState';
import type { Preset } from '@/presets/presets';

/**
 * Marketplace-readiness checks. Pure functions over a small analysis of the finished picture (a downscaled render plus a
 * product-only alpha), so they are unit tested with synthetic images. Thresholds are starting points, not platform rules.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail';

export type Fix =
  | { kind: 'transform'; transform: TransformState }
  | { kind: 'background'; background: BackgroundState }
  | { kind: 'editor'; why: string }
  | { kind: 'format'; format: 'png' | 'jpeg' };

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: { label: string; action: Fix };
}

/** What the checks look at. Images are RGBA / alpha at a small analysis size (long side about 512). */
export interface Analysis {
  w: number;
  h: number;
  /** The composite as exported (background, shadow, product), straight RGBA. */
  rgba: Uint8Array;
  /** The product alone (no shadow, no background), alpha 0..255. */
  productAlpha: Uint8Array;
  /** Output size in px (the real one, not the analysis size). */
  outWidth: number;
  outHeight: number;
  /** Output pixels per photo pixel (above 1 means the photo is enlarged). */
  upscale: number;
  background: BackgroundState;
  format: 'png' | 'jpeg';
  fileBytes: number | null;
  /** Counts from the clean-up analysis of the final mask. */
  cleanup: { specks: number; blobs: number; holes: number; pinholes: number };
  /** Transform to offer as the "centre and scale" fix. */
  framingFix: TransformState;
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function productBox(a: Analysis) {
  let l = a.w;
  let t = a.h;
  let r = -1;
  let b = -1;
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++)
      if (a.productAlpha[y * a.w + x]! > 127) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
  return r < 0 ? null : { l, t, r: r + 1, b: b + 1 };
}

/** Variance of the Laplacian over the product's pixels (a standard blur measure); also the luma spread. */
export function laplacianVariance(a: Analysis): {
  variance: number;
  spread: number;
  pixels: number;
} {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  let ls = 0;
  let ls2 = 0;
  for (let y = 1; y < a.h - 1; y++)
    for (let x = 1; x < a.w - 1; x++) {
      const i = y * a.w + x;
      if (a.productAlpha[i]! < 250) continue;
      const g = (j: number) => luma(a.rgba[j * 4]!, a.rgba[j * 4 + 1]!, a.rgba[j * 4 + 2]!);
      // skip pixels whose neighbourhood touches the product edge (the silhouette itself is not "detail")
      if (
        a.productAlpha[i - 1]! < 250 ||
        a.productAlpha[i + 1]! < 250 ||
        a.productAlpha[i - a.w]! < 250 ||
        a.productAlpha[i + a.w]! < 250
      )
        continue;
      const c = g(i);
      const lap = g(i - 1) + g(i + 1) + g(i - a.w) + g(i + a.w) - 4 * c;
      sum += lap;
      sum2 += lap * lap;
      ls += c;
      ls2 += c * c;
      n++;
    }
  if (n < 50) return { variance: 0, spread: 0, pixels: n };
  const m = sum / n;
  const lm = ls / n;
  return {
    variance: sum2 / n - m * m,
    spread: Math.sqrt(Math.max(0, ls2 / n - lm * lm)),
    pixels: n,
  };
}

export function runChecks(a: Analysis, preset: Preset | null): Check[] {
  const out: Check[] = [];
  const box = productBox(a);
  const opaqueBg = a.background.kind === 'color' ? a.background.color : null;

  // 1. background purity
  if (opaqueBg) {
    const n = parseInt(opaqueBg.slice(1), 16);
    const tgt = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const m = Math.max(2, Math.round(Math.min(a.w, a.h) * 0.03));
    let total = 0;
    let off = 0;
    for (let y = 0; y < a.h; y++)
      for (let x = 0; x < a.w; x++) {
        if (x >= m && x < a.w - m && y >= m && y < a.h - m) continue;
        total++;
        const i = (y * a.w + x) * 4;
        if (
          Math.abs(a.rgba[i]! - tgt[0]!) > 3 ||
          Math.abs(a.rgba[i + 1]! - tgt[1]!) > 3 ||
          Math.abs(a.rgba[i + 2]! - tgt[2]!) > 3
        )
          off++;
      }
    const frac = off / Math.max(1, total);
    out.push({
      id: 'background',
      label: 'Background is the pure colour',
      status: frac < 0.005 ? 'pass' : frac < 0.05 ? 'warn' : 'fail',
      detail:
        frac < 0.005
          ? `The border matches ${opaqueBg}.`
          : `${(frac * 100).toFixed(1)}% of the border differs from ${opaqueBg} (shadow or product reaching the edge?).`,
    });
  } else if (a.background.kind === 'gradient') {
    out.push({
      id: 'background',
      label: 'Background is the pure colour',
      status: 'warn',
      detail: 'A gradient is not a pure colour; many marketplaces want plain white.',
    });
  }

  // 2. fill ratio + 3. centring and margins
  if (!box) {
    out.push({
      id: 'fill',
      label: 'Product fills the frame',
      status: 'fail',
      detail: 'No product was found in the picture.',
    });
  } else {
    const fill = Math.max((box.r - box.l) / a.w, (box.b - box.t) / a.h);
    const lo = preset?.fill.min ?? 0.6;
    const hi = preset?.fill.max ?? 0.95;
    const ok = fill >= lo && fill <= hi;
    const target = preset?.fill.target ?? 0.85;
    out.push({
      id: 'fill',
      label: 'Product fills the frame',
      status: ok ? 'pass' : 'warn',
      detail: `The product takes ${(fill * 100).toFixed(0)}% of the canvas (aim for ${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%).`,
      fix: ok
        ? undefined
        : {
            label: `Centre and scale to ${(target * 100).toFixed(0)}%`,
            action: { kind: 'transform', transform: a.framingFix },
          },
    });
    const dx = (box.l + box.r) / 2 / a.w - 0.5;
    const dy = (box.t + box.b) / 2 / a.h - 0.5;
    const off = Math.max(Math.abs(dx), Math.abs(dy));
    const minMargin = Math.min(box.l / a.w, (a.w - box.r) / a.w, box.t / a.h, (a.h - box.b) / a.h);
    const clipped = box.l <= 0 || box.t <= 0 || box.r >= a.w || box.b >= a.h;
    out.push({
      id: 'centre',
      label: 'Centred, with margins',
      status: clipped ? 'fail' : off <= 0.03 && minMargin >= 0.02 ? 'pass' : 'warn',
      detail: clipped
        ? 'The product touches or crosses the edge of the picture.'
        : `Off centre by ${(off * 100).toFixed(1)}%, smallest margin ${(minMargin * 100).toFixed(1)}%.`,
      fix:
        clipped || off > 0.03 || minMargin < 0.02
          ? { label: 'Centre it', action: { kind: 'transform', transform: a.framingFix } }
          : undefined,
    });
  }

  // 4. output resolution
  const wantW = preset && preset.canvas.aspect !== 'original' ? preset.canvas.width : 0;
  const wantH = preset && preset.canvas.aspect !== 'original' ? preset.canvas.height : 0;
  const small = a.outWidth < wantW || a.outHeight < wantH;
  out.push({
    id: 'resolution',
    label: 'Resolution',
    status: small ? 'fail' : a.upscale > 1.5 ? 'warn' : a.upscale > 1.05 ? 'warn' : 'pass',
    detail: small
      ? `The picture is ${a.outWidth}x${a.outHeight}; the preset asks for ${wantW}x${wantH}.`
      : a.upscale > 1.05
        ? `${a.outWidth}x${a.outHeight}, but the photo's pixels are enlarged ${a.upscale.toFixed(2)}x, so it may look soft. A closer or higher resolution photo helps.`
        : `${a.outWidth}x${a.outHeight} at full photo resolution.`,
  });

  // 5. sharpness
  const lv = laplacianVariance(a);
  if (box && lv.pixels >= 50) {
    const flat = lv.spread < 6;
    out.push({
      id: 'sharpness',
      label: 'Sharp',
      status: flat ? 'pass' : lv.variance < 8 ? 'fail' : lv.variance < 40 ? 'warn' : 'pass',
      detail: flat
        ? 'The product is a flat colour, so sharpness cannot be judged.'
        : `Detail measure ${lv.variance.toFixed(0)} (below about 40 looks soft).`,
    });
  }

  // 6. exposure clipping
  if (box) {
    let n = 0;
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < a.w * a.h; i++) {
      if (a.productAlpha[i]! < 250) continue;
      const y = luma(a.rgba[i * 4]!, a.rgba[i * 4 + 1]!, a.rgba[i * 4 + 2]!);
      n++;
      if (y >= 250) hi++;
      if (y <= 4) lo++;
    }
    const fh = n ? hi / n : 0;
    const fl = n ? lo / n : 0;
    out.push({
      id: 'exposure',
      label: 'Exposure',
      status: fh > 0.08 ? 'warn' : fl > 0.35 ? 'warn' : 'pass',
      detail:
        fh > 0.08
          ? `${(fh * 100).toFixed(0)}% of the product is blown out to white.`
          : fl > 0.35
            ? `${(fl * 100).toFixed(0)}% of the product is crushed to pure black; detail may be lost.`
            : 'No large blown highlights or crushed shadows.',
    });
  }

  // 7./8. leftovers and holes
  const left = a.cleanup.specks + a.cleanup.blobs;
  out.push({
    id: 'leftovers',
    label: 'No leftover pieces',
    status: left === 0 ? 'pass' : 'warn',
    detail:
      left === 0
        ? 'No specks or attached pieces found.'
        : `${a.cleanup.specks} speck(s) and ${a.cleanup.blobs} attached piece(s) may be left over.`,
    fix:
      left === 0
        ? undefined
        : { label: 'Review in the editor', action: { kind: 'editor', why: 'suggestions' } },
  });
  const holes = a.cleanup.holes + a.cleanup.pinholes;
  out.push({
    id: 'holes',
    label: 'Holes are cut',
    status: holes === 0 ? 'pass' : 'warn',
    detail:
      holes === 0
        ? 'No unfilled openings or pin-holes found.'
        : `${a.cleanup.holes} opening(s) may still show the old background, ${a.cleanup.pinholes} pin-hole(s).`,
    fix:
      holes === 0
        ? undefined
        : { label: 'Review in the editor', action: { kind: 'editor', why: 'suggestions' } },
  });

  // 9. transparency
  let transparent = 0;
  for (let i = 0; i < a.w * a.h; i++) if (a.rgba[i * 4 + 3]! < 255) transparent++;
  if (a.background.kind === 'transparent') {
    out.push({
      id: 'transparency',
      label: 'Transparency',
      status: a.format === 'jpeg' ? 'fail' : transparent > 0 ? 'pass' : 'fail',
      detail:
        a.format === 'jpeg'
          ? 'JPEG cannot be transparent.'
          : transparent > 0
            ? 'The background is genuinely transparent.'
            : 'The picture has no transparent pixels.',
      fix:
        a.format === 'jpeg'
          ? { label: 'Use PNG', action: { kind: 'format', format: 'png' } }
          : undefined,
    });
  } else {
    out.push({
      id: 'transparency',
      label: 'Opaque background',
      status: transparent === 0 ? 'pass' : 'warn',
      detail:
        transparent === 0
          ? 'Every pixel is opaque, as the preset needs.'
          : `${transparent} pixel(s) are still transparent.`,
    });
  }

  // 10. file size
  if (preset?.maxFileKB && a.fileBytes !== null) {
    const kb = a.fileBytes / 1024;
    out.push({
      id: 'filesize',
      label: 'File size',
      status: kb <= preset.maxFileKB ? 'pass' : 'fail',
      detail: `${kb.toFixed(0)} KB (limit ${preset.maxFileKB} KB).`,
    });
  }
  return out;
}

export const worst = (checks: Check[]): CheckStatus =>
  checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
