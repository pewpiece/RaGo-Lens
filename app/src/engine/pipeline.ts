import type { SkImage } from '@shopify/react-native-skia';
import { maskBoundsExact } from './postprocess';
import type { PreparedPhoto } from './imagePrep';
import { DEFAULT_EDGE, edgeRamp, type EdgeLevel } from './edge';
import { encodePng, maskLayerFromAlpha, tightenMask, toAlpha8 } from './skiaOps';
import { throwIfAborted, toCutoutError, type ImageEngine } from './types';

export interface PipelineDeps {
  /** Import the photo: an upright full-resolution original plus a capped working copy for the model. */
  prepare: (uri: string, cap: number) => Promise<PreparedPhoto>;
  loadImage: (uri: string) => Promise<SkImage>;
  /** Persist mask PNG bytes (so it can be saved with the library item). Returns a file URI. */
  persistMask: (png: Uint8Array) => string;
}

export interface CutoutResult {
  /** The photo as picked (before capping). */
  sourceUri: string;
  /** Upright FULL-RESOLUTION copy of the photo. The mask and every export are at this resolution. */
  workingUri: string;
  width: number;
  height: number;
  /** Set when the photo was larger than the supported maximum and had to be scaled down on import. */
  warning?: string;
  original: SkImage;
  /** Mask at photo resolution (alpha channel = mask). Non-destructive: the photo is never altered. */
  maskLayer: SkImage;
  maskUri: string;
  engineId: string;
  /** False when the engine found (almost) nothing, so the UI can suggest Refine or a retry. */
  foundObject: boolean;
}

export interface RunCutoutOptions {
  uri: string;
  /** Max long edge of the working image, in px. */
  cap: number;
  engine: ImageEngine;
  /** How tightly the edge hugs the object (default 'normal'). */
  edge?: EdgeLevel;
  signal?: AbortSignal;
  onProgress?: (fraction: number, label: string) => void;
}

/**
 * photo -> (cap size) -> engine mask -> upscale to full working size -> mask layer.
 * The mask is applied as the alpha channel of the full-resolution working image (see skiaOps.applyMaskLayer),
 * never the other way round, so detail is not lost to the model's low-resolution output.
 */
export async function runCutout(opts: RunCutoutOptions, deps: PipelineDeps): Promise<CutoutResult> {
  const { uri, cap, engine, signal, onProgress, edge = DEFAULT_EDGE } = opts;
  try {
    throwIfAborted(signal);
    onProgress?.(0.02, 'Reading photo');
    const photo = await deps.prepare(uri, cap);
    const prepared = photo.original;
    throwIfAborted(signal);

    // the model only ever sees the working copy; the mask is then brought up to the full photo size
    const mask = await engine.segment(
      { uri: photo.working.uri, width: photo.working.width, height: photo.working.height },
      {
        signal,
        onProgress: (f, label) => onProgress?.(0.1 + f * 0.7, label),
      },
    );
    throwIfAborted(signal);

    onProgress?.(0.82, 'Sharpening edges');
    const original = await deps.loadImage(prepared.uri);
    throwIfAborted(signal);
    const { lo, hi } = edgeRamp(edge);
    // upscale to the photo size, pull the edge in, then keep it as a compact 1-byte-per-pixel mask
    const maskLayer = toAlpha8(
      tightenMask(
        maskLayerFromAlpha(mask.alpha, mask.width, mask.height, prepared.width, prepared.height),
        lo,
        hi,
      ),
    );
    throwIfAborted(signal);

    onProgress?.(0.95, 'Saving');
    const maskUri = deps.persistMask(encodePng(maskLayer));
    onProgress?.(1, 'Done');
    return {
      sourceUri: uri,
      workingUri: prepared.uri,
      width: prepared.width,
      height: prepared.height,
      original,
      maskLayer,
      maskUri,
      engineId: engine.id,
      foundObject: maskBoundsExact(mask.alpha, mask.width, mask.height, 32) !== null,
      ...(photo.scaledDownFrom
        ? {
            warning: `This photo (${photo.scaledDownFrom.width}×${photo.scaledDownFrom.height}) is larger than the supported maximum, so it was scaled down to ${prepared.width}×${prepared.height}.`,
          }
        : {}),
    };
  } catch (e) {
    throw toCutoutError(e);
  }
}
