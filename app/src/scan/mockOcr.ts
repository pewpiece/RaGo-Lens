import { ScanError } from './errors';
import type { OcrEngine, OcrResult, OcrRunOptions } from './types';

const SAMPLE_LINES = [
  ['MEETING NOTES', 20, 20, 38],
  ['Discussed the launch plan', 20, 90, 20],
  ['Next steps:', 20, 120, 20],
  ['- finish the design', 20, 150, 20],
  ['- write the tests', 20, 176, 20],
  ['1. send the invite', 20, 220, 20],
] as const;

/** Canned result for tests and the developer toggle (UI can be exercised without ML Kit). */
export class MockOcrEngine implements OcrEngine {
  readonly id = 'mock-ocr';
  readonly label = 'Mock text recogniser';
  constructor(
    private readonly opts: { empty?: boolean; failWith?: Error; delayMs?: number } = {},
  ) {}

  async recognize(_uri: string, { signal }: OcrRunOptions): Promise<OcrResult> {
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    if (signal?.aborted) throw new ScanError('cancelled', 'Cancelled');
    if (this.opts.failWith) throw this.opts.failWith;
    if (this.opts.empty) return { text: '', blocks: [] };
    const lines = SAMPLE_LINES.map(([text, left, top, height]) => ({
      text,
      frame: { left, top, width: text.length * 10, height },
    }));
    return {
      text: lines.map((l) => l.text).join('\n'),
      blocks: lines.map((l) => ({ text: l.text, frame: l.frame, lines: [l] })),
    };
  }
}
