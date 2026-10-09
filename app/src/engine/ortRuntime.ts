import { CutoutError } from './types';
import type { OrtLike } from './onnxEngine';

let cached: OrtLike | null = null;

/**
 * Loads ONNX Runtime on first use. Importing it has native side effects (it installs a JSI binding), and if the
 * native module is missing the import throws. Doing it lazily and wrapping the failure turns what used to be a
 * hard app crash on the processing screen into an error message the user can read.
 */
export function loadOrt(): OrtLike {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('onnxruntime-react-native') as { InferenceSession: unknown; Tensor: unknown };
    if (!m?.InferenceSession) throw new Error('InferenceSession is missing');
    cached = { InferenceSession: m.InferenceSession, Tensor: m.Tensor } as unknown as OrtLike;
    return cached;
  } catch (e) {
    throw new CutoutError(
      'model-load-failed',
      `The on-device model runtime could not start (${e instanceof Error ? e.message : String(e)}).`,
      e,
    );
  }
}
