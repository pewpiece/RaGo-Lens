import { loadImage, sampleRgba } from './skiaOps';
import { bundledModelPath } from './modelAsset';
import { MockEngine } from './mockEngine';
import { OnnxSegmentationEngine } from './onnxEngine';
import { ort } from './ortRuntime';
import { devicePrepDeps } from './imagePrepDevice';
import { prepareWorkingImage } from './imagePrep';
import type { PipelineDeps } from './pipeline';
import type { ImageEngine } from './types';
import { tempName, writeCacheFile } from '@/lib/files';

let onnx: OnnxSegmentationEngine | null = null;

/** Returns the active engine. The ONNX engine (and its session) is kept for reuse between photos. */
export function getEngine(useMock: boolean): ImageEngine {
  if (useMock) return new MockEngine({ delayMs: 600 });
  if (!onnx) {
    onnx = new OnnxSegmentationEngine({
      ort,
      modelPath: bundledModelPath,
      sampleRgba: async (input, size) => sampleRgba(await loadImage(input.uri), size, size),
    });
  }
  return onnx;
}

export const devicePipelineDeps: PipelineDeps = {
  prepare: (uri, cap) => prepareWorkingImage(uri, cap, devicePrepDeps),
  loadImage,
  persistMask: (png) => writeCacheFile(tempName('mask', 'png'), png),
};
