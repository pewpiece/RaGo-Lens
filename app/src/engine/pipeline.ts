import type { SkImage } from '@shopify/react-native-skia';
import { maskBounds } from './postprocess';
import type { PreparedImage } from './imagePrep';
import { encodePng, maskLayerFromAlpha } from './skiaOps';
import { throwIfAborted, toCutoutError, type ImageEngine } from './types';

export interface PipelineDeps {
  /** Load the photo into an upright JPEG with its long edge capped. */
  prepare: (uri: string, cap: number) => Promise<PreparedImage>;
  loadImage: (uri: string) => Promise<SkImage>;
  /** Persist mask PNG bytes (so it can be saved with the library item). Returns a file URI. */
  persistMask: (png: Uint8Array) => string;
}

export interface CutoutResult {
  /** The photo as picked (before capping). */
  sourceUri: string;
  /** Upright, size-capped working copy. All masks and exports are at this resolution. */
  workingUri: string;
  width: number;
  height: number;
  original: SkImage;
  /** White RGBA layer at working size whose alpha channel is the mask. Non-destructive: the photo is never altered. */
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
  signal?: AbortSignal;
  onProgress?: (fraction: number, label: string) => void;
}

/**
 * photo -> (cap size) -> engine mask -> upscale to full working size -> mask layer.
 * The mask is applied as the alpha channel of the full-resolution working image (see skiaOps.applyMaskLayer),
 * never the other way round, so detail is not lost to the model's low-resolution output.
 */
export async function runCutout(opts: RunCutoutOptions, deps: PipelineDeps): Promise<CutoutResult> {
  const { uri, cap, engine, signal, onProgress } = opts;
  try {
    throwIfAborted(signal);
    onProgress?.(0.02, 'Reading photo');
    const prepared = await deps.prepare(uri, cap);
    throwIfAborted(signal);

    const mask = await engine.segment(
      { uri: prepared.uri, width: prepared.width, height: prepared.height },
      {
        signal,
        onProgress: (f, label) => onProgress?.(0.1 + f * 0.7, label),
      },
    );
    throwIfAborted(signal);

    onProgress?.(0.82, 'Sharpening edges');
    const original = await deps.loadImage(prepared.uri);
    throwIfAborted(signal);
    const maskLayer = maskLayerFromAlpha(
      mask.alpha,
      mask.width,
      mask.height,
      prepared.width,
      prepared.height,
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
      foundObject: maskBounds(mask.alpha, mask.width, mask.height, 32) !== null,
    };
  } catch (e) {
    throw toCutoutError(e);
  }
}
