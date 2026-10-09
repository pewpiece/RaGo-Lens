export type ScanErrorCode =
  'cancelled' | 'ocr-unavailable' | 'ocr-failed' | 'unreadable-image' | 'out-of-memory';

export class ScanError extends Error {
  constructor(
    public readonly code: ScanErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ScanError';
  }
}

export const isScanCancelled = (e: unknown): boolean =>
  e instanceof ScanError && e.code === 'cancelled';

export function throwIfScanAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ScanError('cancelled', 'Cancelled');
}

/** Anything thrown while scanning -> a ScanError with a message fit to show the user. */
export function toScanError(e: unknown): ScanError {
  if (e instanceof ScanError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/out of memory|\boom\b|bad_alloc|OutOfMemory|failed to allocate/i.test(msg)) {
    return new ScanError(
      'out-of-memory',
      'The phone ran out of memory. Try again with a smaller photo.',
      e,
    );
  }
  if (
    /decode|unreadable|unsupported image|no such file|not found|ENOENT|could not load|failed to load|FileNotFound/i.test(
      msg,
    )
  ) {
    return new ScanError('unreadable-image', 'That image could not be read. Try another photo.', e);
  }
  return new ScanError('ocr-failed', 'Text recognition failed on this photo.', e);
}
