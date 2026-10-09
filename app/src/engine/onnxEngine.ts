import { MODEL_INPUT_SIZE, rgbaToNchw } from './preprocess';
import { postprocessMask } from './postprocess';
import {
  CutoutError,
  throwIfAborted,
  toCutoutError,
  type EngineInput,
  type EngineRunOptions,
  type ImageEngine,
  type MaskResult,
} from './types';

/** The small slice of onnxruntime-react-native that we use; lets tests inject a fake. */
export interface OrtTensorLike {
  data: ArrayLike<number>;
  dims: readonly number[];
}
export interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release(): Promise<void>;
}
export interface OrtLike {
  InferenceSession: {
    create(modelPath: string, options?: Record<string, unknown>): Promise<OrtSessionLike>;
  };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}

export interface OnnxEngineDeps {
  ort: OrtLike;
  /** Resolves to a local filesystem path of the .onnx file, or throws CutoutError('model-missing'). */
  modelPath: () => Promise<string>;
  /** Image -> RGBA bytes resampled to size x size (Skia on device). */
  sampleRgba: (input: EngineInput, size: number) => Promise<Uint8Array>;
}

/**
 * Salient-object segmentation with a U-2-Net-class ONNX model.
 * Inference runs inside the native ONNX Runtime module, so the JS/UI thread only awaits the result.
 * Note: ONNX Runtime React Native cannot abort a run in flight; cancellation takes effect between stages
 * (the finished result is discarded).
 */
export class OnnxSegmentationEngine implements ImageEngine {
  readonly id = 'onnx-u2netp';
  readonly label = 'U²-Net-P (ONNX, on device)';
  private session: Promise<OrtSessionLike> | null = null;

  constructor(private readonly deps: OnnxEngineDeps) {}

  private getSession(): Promise<OrtSessionLike> {
    if (!this.session) {
      this.session = (async () => {
        const path = await this.deps.modelPath();
        try {
          return await this.deps.ort.InferenceSession.create(path, { graphOptimizationLevel: 'all' });
        } catch (e) {
          throw new CutoutError(
            'model-load-failed',
            'The segmentation model could not be loaded. Reinstall the app or check the model file.',
            e,
          );
        }
      })();
      // a failed load must not be cached forever (Retry should try again)
      this.session.catch(() => {
        this.session = null;
      });
    }
    return this.session;
  }

  async segment(input: EngineInput, options: EngineRunOptions = {}): Promise<MaskResult> {
    const { signal, onProgress } = options;
    try {
      throwIfAborted(signal);
      onProgress?.(0.05, 'Loading model');
      const session = await this.getSession();
      throwIfAborted(signal);

      onProgress?.(0.25, 'Preparing photo');
      const N = MODEL_INPUT_SIZE;
      const rgba = await this.deps.sampleRgba(input, N);
      const tensorData = rgbaToNchw(rgba, N, N);
      throwIfAborted(signal);

      onProgress?.(0.4, 'Finding the object');
      const inputName = session.inputNames[0];
      if (!inputName) throw new Error('Model has no inputs');
      const feeds = { [inputName]: new this.deps.ort.Tensor('float32', tensorData, [1, 3, N, N]) };
      const outputs = await session.run(feeds);
      throwIfAborted(signal);

      const out = outputs[session.outputNames[0]!];
      if (!out) throw new Error('Model returned no output');
      if (out.data.length < N * N) throw new Error(`Unexpected model output size ${out.data.length}`);
      onProgress?.(0.9, 'Refining edges');
      const mask = postprocessMask(out.data, N, N);
      onProgress?.(1, 'Done');
      return mask;
    } catch (e) {
      throw toCutoutError(e);
    }
  }

  async dispose(): Promise<void> {
    const s = this.session;
    this.session = null;
    if (s) {
      try {
        await (await s).release();
      } catch {
        /* nothing to release */
      }
    }
  }
}
