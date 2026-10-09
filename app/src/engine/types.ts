/** Alpha mask: one byte per pixel, 0 = background, 255 = object. */
export interface MaskResult {
  alpha: Uint8Array;
  width: number;
  height: number;
}

export interface EngineInput {
  /** Readable image URI (file://). Already EXIF-normalised and size-capped by the pipeline. */
  uri: string;
  width: number;
  height: number;
}

export interface EngineRunOptions {
  signal?: AbortSignal;
  /** 0..1 progress with a short label, for the processing screen. */
  onProgress?: (fraction: number, label: string) => void;
}

/** A swappable background-removal engine. Future modes/models implement the same contract. */
export interface ImageEngine {
  readonly id: string;
  readonly label: string;
  segment(input: EngineInput, options?: EngineRunOptions): Promise<MaskResult>;
  dispose?(): Promise<void> | void;
}

export type CutoutErrorCode =
  | 'cancelled'
  | 'model-missing'
  | 'model-load-failed'
  | 'out-of-memory'
  | 'unreadable-image'
  | 'inference-failed'
  | 'storage';

export class CutoutError extends Error {
  constructor(
    public readonly code: CutoutErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CutoutError';
  }
}

export const isCancelled = (e: unknown): boolean => e instanceof CutoutError && e.code === 'cancelled';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CutoutError('cancelled', 'Cancelled');
}

/** Turns anything thrown during processing into a CutoutError with a user-presentable message. */
export function toCutoutError(e: unknown): CutoutError {
  if (e instanceof CutoutError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/out of memory|oom|allocation|bad_alloc|OutOfMemory/i.test(msg)) {
    return new CutoutError(
      'out-of-memory',
      'The phone ran out of memory. Try a smaller working size in Settings.',
      e,
    );
  }
  if (/decode|unreadable|unsupported image|no such file|not found|ENOENT|could not load/i.test(msg)) {
    return new CutoutError('unreadable-image', 'That image could not be read. Try another photo.', e);
  }
  return new CutoutError('inference-failed', 'Something went wrong while removing the background.', e);
}
