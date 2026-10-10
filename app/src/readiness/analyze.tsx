import { framingTransform } from '@/compose/layout';
import type { ProductInputs } from '@/compose/ComposeTree';
import { layoutFor, renderComposite, type ComposeSpec, type OutputFormat } from '@/compose/render';
import { makeAnalysis } from '@/editor/analysis';
import { suggestCleanups } from '@/editor/suggest';
import { readAlpha, resizeImage, sampleRgba } from '@/engine/skiaOps';
import type { ProductSource } from '@/export/productSource';
import { maskToImage } from '@/mask/maskImage';
import type { Preset } from '@/presets/presets';
import { runChecks, type Analysis, type Check } from './checks';

const ANALYSIS_EDGE = 512;

/** Clean-up counts for the final mask (specks, attached pieces, holes, pin-holes). */
export function cleanupCounts(src: ProductSource) {
  const a = makeAnalysis(src.original);
  const alpha = readAlpha(resizeImage(maskToImage(src.mask), a.w, a.h));
  const s = suggestCleanups({ rgba: a.rgba, alpha, w: a.w, h: a.h });
  const n = (k: string) => s.filter((x) => x.kind === k).length;
  return { specks: n('speck'), blobs: n('blob'), holes: n('hole'), pinholes: n('pinhole') };
}

/**
 * Renders the picture and the product alone at analysis size and runs the readiness checks on them.
 * `rendered` is the real export (so its size and file size are exact); the product-only render shows where the product is.
 */
export async function analyzeAndCheck(
  product: ProductInputs,
  spec: ComposeSpec,
  fmt: OutputFormat,
  preset: Preset | null,
  rendered: Awaited<ReturnType<typeof renderComposite>>,
  cleanup: Analysis['cleanup'],
): Promise<Check[]> {
  const lay = layoutFor(product, spec, fmt);
  const k = Math.min(1, ANALYSIS_EDGE / Math.max(rendered.width, rendered.height));
  const w = Math.max(1, Math.round(rendered.width * k));
  const h = Math.max(1, Math.round(rendered.height * k));
  const rgba = sampleRgba(rendered.image, w, h);
  const only = await renderComposite(
    product,
    {
      ...spec,
      background: { kind: 'transparent' },
      shadow: { ...spec.shadow, kind: 'none', reflection: false },
    },
    { format: 'png', quality: 100, maxBytes: null },
  );
  const productAlpha = readAlpha(resizeImage(only.image, w, h));
  const fill = spec.canvas.aspect === 'original' ? 1 : (preset?.fill.target ?? spec.fill ?? 0.85);
  const framingFix = framingTransform(product.bounds, spec.transform, lay.size, fill, 'centre');
  return runChecks(
    {
      w,
      h,
      rgba,
      productAlpha,
      outWidth: rendered.width,
      outHeight: rendered.height,
      upscale: lay.placement.k,
      background: lay.background,
      format: rendered.format,
      fileBytes: rendered.bytes.length,
      cleanup,
      framingFix,
    },
    preset,
  );
}
