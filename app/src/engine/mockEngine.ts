import { throwIfAborted, type EngineInput, type EngineRunOptions, type ImageEngine, type MaskResult } from './types';

export interface MockEngineOptions {
  /** Longest side of the generated mask. */
  maskSize?: number;
  /** Artificial latency in ms (to exercise progress/cancel UI and tests). */
  delayMs?: number;
  /** Throw this instead of returning a mask. */
  failWith?: Error;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Builds a centred ellipse mask with a 1-pixel soft edge. Used by tests and the developer toggle. */
export function ellipseMask(width: number, height: number): MaskResult {
  const alpha = new Uint8Array(width * height);
  const rx = width * 0.36;
  const ry = height * 0.36;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry); // 1 on the ellipse edge
      const edge = (1 - d) * Math.min(rx, ry); // distance to edge in pixels (positive inside)
      alpha[y * width + x] = Math.round(255 * Math.min(1, Math.max(0, edge + 0.5)));
    }
  }
  return { alpha, width, height };
}

export class MockEngine implements ImageEngine {
  readonly id = 'mock';
  readonly label = 'Mock (centre ellipse)';
  constructor(private readonly opts: MockEngineOptions = {}) {}

  async segment(input: EngineInput, options: EngineRunOptions = {}): Promise<MaskResult> {
    const { signal, onProgress } = options;
    throwIfAborted(signal);
    onProgress?.(0.1, 'Preparing');
    if (this.opts.delayMs) await sleep(this.opts.delayMs / 2);
    throwIfAborted(signal);
    if (this.opts.failWith) throw this.opts.failWith;
    onProgress?.(0.6, 'Finding the object');
    if (this.opts.delayMs) await sleep(this.opts.delayMs / 2);
    throwIfAborted(signal);
    const size = this.opts.maskSize ?? 256;
    const scale = size / Math.max(input.width, input.height);
    const mask = ellipseMask(Math.max(2, Math.round(input.width * scale)), Math.max(2, Math.round(input.height * scale)));
    onProgress?.(1, 'Done');
    return mask;
  }
}
