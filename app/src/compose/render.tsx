import { drawAsImage, ImageFormat, type SkImage } from '@shopify/react-native-skia';
import type { BackgroundState, EditState } from '@/edit/editState';
import { pngHasAlphaChannel } from '@/export/png';
import { encodePng } from '@/engine/skiaOps';
import { ComposeTree, type ProductInputs } from './ComposeTree';
import { canvasSizeFor, placeProduct, type CanvasSize, type Placement } from './layout';

export interface OutputFormat {
  format: 'png' | 'jpeg';
  /** 1..100, JPEG only. */
  quality: number;
  /** JPEG only: lower the quality until the file fits (never below `minQuality`); null = no limit. */
  maxBytes: number | null;
}

export const PNG_FORMAT: OutputFormat = { format: 'png', quality: 100, maxBytes: null };

export interface ComposeSpec {
  canvas: EditState['canvas'];
  transform: EditState['transform'];
  shadow: EditState['shadow'];
  background: BackgroundState;
  /** Share of the canvas the product fills along its tighter axis at scale 1; null = natural size. */
  fill: number | null;
}

export interface Layout {
  size: CanvasSize;
  placement: Placement;
  /** The background actually drawn (a JPEG cannot be transparent, so it is forced to white). */
  background: BackgroundState;
}

export function layoutFor(product: ProductInputs, spec: ComposeSpec, fmt: OutputFormat): Layout {
  const size = canvasSizeFor(spec.canvas, product.bounds, spec.transform.rotation);
  const fill = spec.canvas.aspect === 'original' ? null : spec.fill;
  const background: BackgroundState =
    fmt.format === 'jpeg' && spec.background.kind === 'transparent'
      ? { kind: 'color', color: '#FFFFFF' }
      : spec.background;
  return { size, placement: placeProduct(product.bounds, spec.transform, size, fill), background };
}

export interface RenderedComposite {
  image: SkImage;
  bytes: Uint8Array;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  /** Whether the file carries (and must carry) transparency. */
  expectsAlpha: boolean;
  /** JPEG quality finally used. */
  quality: number;
  /** True when a size limit could not be met even at the lowest quality. */
  overLimit: boolean;
}

const MIN_QUALITY = 40;

export async function renderComposite(
  product: ProductInputs,
  spec: ComposeSpec,
  fmt: OutputFormat = PNG_FORMAT,
): Promise<RenderedComposite> {
  const lay = layoutFor(product, spec, fmt);
  const image = await drawAsImage(
    <ComposeTree
      product={product}
      canvas={lay.size}
      placement={lay.placement}
      background={lay.background}
      shadow={spec.shadow}
    />,
    { width: lay.size.w, height: lay.size.h },
  );
  if (!image) throw new Error('Out of memory: could not render the export');
  if (fmt.format === 'png') {
    const bytes = encodePng(image);
    const expectsAlpha = lay.background.kind === 'transparent';
    if (expectsAlpha && !pngHasAlphaChannel(bytes)) {
      throw new Error(
        'Export check failed: the PNG has no alpha channel, transparency would be lost.',
      );
    }
    return {
      image,
      bytes,
      width: lay.size.w,
      height: lay.size.h,
      format: 'png',
      expectsAlpha,
      quality: 100,
      overLimit: false,
    };
  }
  let q = Math.min(100, Math.max(MIN_QUALITY, fmt.quality));
  let bytes = image.encodeToBytes(ImageFormat.JPEG, q);
  if (!bytes) throw new Error('Could not encode the JPEG (out of memory?)');
  while (fmt.maxBytes !== null && bytes.length > fmt.maxBytes && q > MIN_QUALITY) {
    q = Math.max(MIN_QUALITY, q - 5);
    bytes = image.encodeToBytes(ImageFormat.JPEG, q)!;
  }
  return {
    image,
    bytes,
    width: lay.size.w,
    height: lay.size.h,
    format: 'jpeg',
    expectsAlpha: false,
    quality: q,
    overLimit: fmt.maxBytes !== null && bytes.length > fmt.maxBytes,
  };
}
