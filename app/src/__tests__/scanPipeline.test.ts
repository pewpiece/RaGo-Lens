import { ScanError } from '@/scan/errors';
import { mapMlKitResult, MlKitOcrEngine, type MlKitModule } from '@/scan/mlkitEngine';
import { MockOcrEngine } from '@/scan/mockOcr';
import { runScan, type ScanDeps } from '@/scan/pipeline';

const deps: ScanDeps = {
  prepare: async (uri) => ({ uri: `${uri}#work`, width: 3000, height: 2000 }),
};

describe('runScan', () => {
  it('prepares the photo, recognises text and formats it', async () => {
    const stages: string[] = [];
    const r = await runScan(
      {
        uri: 'file:///p.jpg',
        script: 'latin',
        engine: new MockOcrEngine(),
        onProgress: (_, l) => stages.push(l),
      },
      deps,
    );
    expect(r.workingUri).toBe('file:///p.jpg#work');
    expect(r.foundText).toBe(true);
    expect(r.markdown).toContain('## MEETING NOTES');
    expect(r.markdown).toContain('- finish the design');
    expect(r.markdown).toContain('1. send the invite');
    expect(r.plain).toContain('• write the tests');
    expect(r.charCount).toBeGreaterThan(30);
    expect(stages).toEqual(['Reading photo', 'Reading the text', 'Formatting', 'Done']);
  });

  it('reports "no text" instead of failing when the page is blank', async () => {
    const r = await runScan(
      { uri: 'u', script: 'latin', engine: new MockOcrEngine({ empty: true }) },
      deps,
    );
    expect(r.foundText).toBe(false);
    expect(r.markdown).toBe('');
  });

  it('passes the chosen script through to the engine', async () => {
    const recognize = jest.fn(async () => ({ text: '', blocks: [] }));
    await runScan(
      { uri: 'u', script: 'devanagari', engine: { id: 'x', label: 'x', recognize } },
      deps,
    );
    expect(recognize).toHaveBeenCalledWith(
      'u#work',
      expect.objectContaining({ script: 'devanagari' }),
    );
  });

  it('can be cancelled before and during recognition', async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      runScan({ uri: 'u', script: 'latin', engine: new MockOcrEngine(), signal: c.signal }, deps),
    ).rejects.toMatchObject({ code: 'cancelled' });
    const c2 = new AbortController();
    const p = runScan(
      { uri: 'u', script: 'latin', engine: new MockOcrEngine({ delayMs: 50 }), signal: c2.signal },
      deps,
    );
    setTimeout(() => c2.abort(), 5);
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('turns failures into friendly ScanErrors', async () => {
    await expect(
      runScan(
        {
          uri: 'u',
          script: 'latin',
          engine: new MockOcrEngine({ failWith: new Error('java.lang.OutOfMemoryError') }),
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'out-of-memory' });
    await expect(
      runScan(
        {
          uri: 'u',
          script: 'latin',
          engine: new MockOcrEngine({ failWith: new Error('kaboom in the living room') }),
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'ocr-failed' });
    const bad: ScanDeps = {
      prepare: async () => {
        throw new Error('Could not load image');
      },
    };
    await expect(
      runScan({ uri: 'u', script: 'latin', engine: new MockOcrEngine() }, bad),
    ).rejects.toMatchObject({ code: 'unreadable-image' });
  });
});

describe('MlKitOcrEngine', () => {
  const native = (impl: MlKitModule['recognize']): MlKitModule => ({ recognize: impl });

  it('maps the native result and passes the script name', async () => {
    const recognize = jest.fn(async () => ({
      text: 'Hello',
      blocks: [
        {
          text: 'Hello',
          frame: { left: 1, top: 2, width: 30, height: 10 },
          lines: [{ text: 'Hello', frame: { left: 1, top: 2, width: 30, height: 10 } }],
        },
      ],
    }));
    const r = await new MlKitOcrEngine(() => native(recognize)).recognize('file:///a.jpg', {
      script: 'devanagari',
    });
    expect(recognize).toHaveBeenCalledWith('file:///a.jpg', 'Devanagari');
    expect(r.blocks[0]!.lines[0]!.frame).toEqual({ left: 1, top: 2, width: 30, height: 10 });
  });

  it('tolerates missing frames and blocks', () => {
    expect(
      mapMlKitResult({ text: 't', blocks: [{ text: 'a', lines: [{ text: 'a' }] }] }).blocks[0]!
        .lines[0]!.frame,
    ).toBeUndefined();
    expect(mapMlKitResult({ text: 'x' } as never).blocks).toEqual([]);
  });

  it('reports a missing native module as ocr-unavailable', async () => {
    const eng = new MlKitOcrEngine(() => {
      throw new ScanError('ocr-unavailable', 'could not start');
    });
    await expect(eng.recognize('u', { script: 'latin' })).rejects.toMatchObject({
      code: 'ocr-unavailable',
    });
  });

  it('wraps native failures', async () => {
    const eng = new MlKitOcrEngine(() =>
      native(async () => {
        throw new Error('Text recognition failed');
      }),
    );
    await expect(eng.recognize('u', { script: 'latin' })).rejects.toMatchObject({
      code: 'ocr-failed',
    });
  });
});
