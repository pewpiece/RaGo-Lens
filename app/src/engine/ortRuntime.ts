import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import type { OrtLike } from './onnxEngine';

/** The real runtime, adapted to the minimal interface the engine depends on. */
export const ort = { InferenceSession, Tensor } as unknown as OrtLike;
