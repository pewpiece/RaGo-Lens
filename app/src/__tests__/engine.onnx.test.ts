import { OnnxSegmentationEngine, type OrtLike, type OrtSessionLike } from '@/engine/onnxEngine';
import { CutoutError } from '@/engine/types';

function fakeOrt(outputFn: (feed: Record<string, { dims: number[]; data: Float32Array }>) => Float32Array, opts: { createFails?: boolean } = {}) {
  const calls = { create: 0, run: 0, release: 0, lastFeed: undefined as unknown };
  const session: OrtSessionLike = {
    inputNames: ['input.1'],
    outputNames: ['1959', '1960'],
    async run(feeds) {
      calls.run++;
      calls.lastFeed = feeds;
      const data = outputFn(feeds as never);
      return { '1959': { data, dims: [1, 1, 320, 320] }, '1960': { data, dims: [1, 1, 320, 320] } };
    },
    async release() {
      calls.release++;
    },
  };
  const ort: OrtLike = {
    InferenceSession: {
      async create() {
        calls.create++;
        if (opts.createFails) throw new Error('bad model');
        return session;
      },
    },
    Tensor: class {
      constructor(public type: string, public data: Float32Array, public dims: number[]) {}
    } as never,
  };
  return { ort, calls };
}

const grey = async (_: unknown, size: number) => new Uint8Array(size * size * 4).fill(128);
const input = { uri: 'file:///x.jpg', width: 640, height: 480 };

// a fake "model" that outputs a bright square in the middle
const squareOutput = () => {
  const out = new Float32Array(320 * 320).fill(0.02);
  for (let y = 100; y < 220; y++) for (let x = 100; x < 220; x++) out[y * 320 + x] = 0.98;
  return out;
};

describe('OnnxSegmentationEngine', () => {
  it('feeds a [1,3,320,320] float tensor under the model input name and post-processes the first output', async () => {
    const { ort, calls } = fakeOrt(squareOutput);
    const engine = new OnnxSegmentationEngine({ ort, modelPath: async () => '/m.onnx', sampleRgba: grey });
    const progress: number[] = [];
    const mask = await engine.segment(input, { onProgress: (f) => progress.push(f) });
    const feed = (calls.lastFeed as Record<string, { dims: number[]; data: Float32Array; type: string }>)['input.1']!;
    expect(feed.dims).toEqual([1, 3, 320, 320]);
    expect(feed.type).toBe('float32');
    expect(feed.data).toHaveLength(3 * 320 * 320);
    expect([mask.width, mask.height]).toEqual([320, 320]);
    expect(mask.alpha[160 * 320 + 160]).toBe(255);
    expect(mask.alpha[10 * 320 + 10]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('creates the session once and reuses it', async () => {
    const { ort, calls } = fakeOrt(squareOutput);
    const engine = new OnnxSegmentationEngine({ ort, modelPath: async () => '/m.onnx', sampleRgba: grey });
    await engine.segment(input);
    await engine.segment(input);
    expect(calls.create).toBe(1);
    expect(calls.run).toBe(2);
    await engine.dispose();
    expect(calls.release).toBe(1);
  });

  it('reports a missing model clearly and retries on the next call', async () => {
    const { ort } = fakeOrt(squareOutput);
    let attempts = 0;
    const engine = new OnnxSegmentationEngine({
      ort,
      modelPath: async () => {
        attempts++;
        if (attempts === 1) throw new CutoutError('model-missing', 'missing');
        return '/m.onnx';
      },
      sampleRgba: grey,
    });
    await expect(engine.segment(input)).rejects.toMatchObject({ code: 'model-missing' });
    await expect(engine.segment(input)).resolves.toBeDefined();
  });

  it('maps a session load failure to model-load-failed', async () => {
    const { ort } = fakeOrt(squareOutput, { createFails: true });
    const engine = new OnnxSegmentationEngine({ ort, modelPath: async () => '/m.onnx', sampleRgba: grey });
    await expect(engine.segment(input)).rejects.toMatchObject({ code: 'model-load-failed' });
  });

  it('maps out-of-memory failures during the run', async () => {
    const { ort } = fakeOrt(() => {
      throw new Error('java.lang.OutOfMemoryError: Failed to allocate');
    });
    const engine = new OnnxSegmentationEngine({ ort, modelPath: async () => '/m.onnx', sampleRgba: grey });
    await expect(engine.segment(input)).rejects.toMatchObject({ code: 'out-of-memory' });
  });

  it('rejects an output of the wrong size', async () => {
    const { ort } = fakeOrt(() => new Float32Array(10));
    const engine = new OnnxSegmentationEngine({ ort, modelPath: async () => '/m.onnx', sampleRgba: grey });
    await expect(engine.segment(input)).rejects.toMatchObject({ code: 'inference-failed' });
  });

  it('honours cancellation between stages and discards the result', async () => {
    const { ort } = fakeOrt(squareOutput);
    const c = new AbortController();
    const engine = new OnnxSegmentationEngine({
      ort,
      modelPath: async () => '/m.onnx',
      sampleRgba: async (i, s) => {
        c.abort();
        return grey(i, s);
      },
    });
    await expect(engine.segment(input, { signal: c.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
});
