import type { PreparedImage } from '@/engine/imagePrep';
import { formatScan } from './format';
import { throwIfScanAborted, toScanError } from './errors';
import type { FormattedScan, OcrEngine, ScanScript } from './types';

export interface ScanDeps {
  /** Upright JPEG with its long edge capped (text needs more pixels than a cut-out). */
  prepare: (uri: string, cap: number) => Promise<PreparedImage>;
}

export interface ScanResult {
  sourceUri: string;
  workingUri: string;
  width: number;
  height: number;
  /** Markdown with headings, lists and paragraphs. */
  markdown: string;
  plain: string;
  /** Number of recognised characters (excluding whitespace). */
  charCount: number;
  engineId: string;
  script: ScanScript;
  /** False when nothing readable was found. */
  foundText: boolean;
  formatted: FormattedScan;
}

export const SCAN_WORKING_CAP = 3072;

export interface RunScanOptions {
  uri: string;
  script: ScanScript;
  engine: OcrEngine;
  signal?: AbortSignal;
  cap?: number;
  onProgress?: (fraction: number, label: string) => void;
}

/** photo -> upright, size-capped copy -> text recognition -> structure (headings, lists, paragraphs). */
export async function runScan(opts: RunScanOptions, deps: ScanDeps): Promise<ScanResult> {
  const { uri, script, engine, signal, onProgress, cap = SCAN_WORKING_CAP } = opts;
  try {
    throwIfScanAborted(signal);
    onProgress?.(0.05, 'Reading photo');
    const prepared = await deps.prepare(uri, cap);
    throwIfScanAborted(signal);

    onProgress?.(0.3, 'Reading the text');
    const raw = await engine.recognize(prepared.uri, { script, signal });
    throwIfScanAborted(signal);

    onProgress?.(0.9, 'Formatting');
    const formatted = formatScan(raw);
    const charCount = formatted.plain.replace(/\s+/g, '').length;
    onProgress?.(1, 'Done');
    return {
      sourceUri: uri,
      workingUri: prepared.uri,
      width: prepared.width,
      height: prepared.height,
      markdown: formatted.markdown,
      plain: formatted.plain,
      charCount,
      engineId: engine.id,
      script,
      foundText: charCount > 0,
      formatted,
    };
  } catch (e) {
    throw toScanError(e);
  }
}
