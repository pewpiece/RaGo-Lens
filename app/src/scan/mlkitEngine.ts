import { ScanError, throwIfScanAborted, toScanError } from './errors';
import type { OcrBlock, OcrEngine, OcrFrame, OcrResult, OcrRunOptions, ScanScript } from './types';

/** Shape returned by @react-native-ml-kit/text-recognition (only the parts we use). */
export interface MlKitFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface MlKitResult {
  text: string;
  blocks: { text: string; frame?: MlKitFrame; lines: { text: string; frame?: MlKitFrame }[] }[];
}
export interface MlKitModule {
  recognize(uri: string, script?: string): Promise<MlKitResult>;
}

const SCRIPT_NAME: Record<ScanScript, string> = { latin: 'Latin', devanagari: 'Devanagari' };

const frameOf = (f?: MlKitFrame): OcrFrame | undefined =>
  f && Number.isFinite(f.left) && Number.isFinite(f.top)
    ? { left: f.left, top: f.top, width: f.width, height: f.height }
    : undefined;

export function mapMlKitResult(r: MlKitResult): OcrResult {
  const blocks: OcrBlock[] = (r.blocks ?? []).map((b) => ({
    text: b.text,
    frame: frameOf(b.frame),
    lines: (b.lines ?? []).map((l) => ({ text: l.text, frame: frameOf(l.frame) })),
  }));
  return { text: r.text ?? '', blocks };
}

/** Loaded lazily so a missing native module becomes a readable error instead of an app crash. */
export function loadMlKit(): MlKitModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@react-native-ml-kit/text-recognition') as { default?: MlKitModule };
    const mod = m.default ?? (m as unknown as MlKitModule);
    if (typeof mod?.recognize !== 'function') throw new Error('recognize() is missing');
    return mod;
  } catch (e) {
    throw new ScanError(
      'ocr-unavailable',
      `The text recogniser could not start (${e instanceof Error ? e.message : String(e)}).`,
      e,
    );
  }
}

/** On-device text recognition with Google ML Kit (models are bundled in the app: works offline). */
export class MlKitOcrEngine implements OcrEngine {
  readonly id = 'mlkit';
  readonly label = 'Google ML Kit (on device)';
  constructor(private readonly load: () => MlKitModule = loadMlKit) {}

  async recognize(imageUri: string, { script, signal }: OcrRunOptions): Promise<OcrResult> {
    try {
      throwIfScanAborted(signal);
      const mod = this.load();
      const raw = await mod.recognize(imageUri, SCRIPT_NAME[script]);
      throwIfScanAborted(signal);
      return mapMlKitResult(raw);
    } catch (e) {
      throw toScanError(e);
    }
  }
}
