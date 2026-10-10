import { sampleRgba } from './skiaOps';
import { loadImage } from '@/lib/loadImage';
import { bundledModelPath } from './modelAsset';
import { MockEngine } from './mockEngine';
import { OnnxSegmentationEngine } from './onnxEngine';
import { loadOrt } from './ortRuntime';
import { devicePrepDeps } from './imagePrepDevice';
import { preparePhoto } from './imagePrep';
import type { PipelineDeps } from './pipeline';
import type { ImageEngine } from './types';
import { tempName, writeCacheFile } from '@/lib/files';
import { enhanceWorkingCopy } from '@/enhance/apply';

let onnx: OnnxSegmentationEngine | null = null;

/** Returns the active engine. The ONNX engine (and its session) is kept for reuse between photos. */
export function getEngine(useMock: boolean): ImageEngine {
  if (useMock) return new MockEngine({ delayMs: 600 });
  if (!onnx) {
    onnx = new OnnxSegmentationEngine({
      ort: loadOrt,
      modelPath: bundledModelPath,
      sampleRgba: async (input, size) => sampleRgba(await loadImage(input.uri), size, size),
    });
  }
  return onnx;
}

/** Writes an enhanced copy of the working photo (auto exposure / white balance) and returns it with the matrix used. */
async function enhanceWorkingFile(uri: string, strength: number) {
  const img = await loadImage(uri);
  const r = enhanceWorkingCopy(img, strength);
  if (!r.jpeg) return null;
  return { uri: writeCacheFile(tempName('enhanced', 'jpg'), r.jpeg), matrix: r.matrix };
}

export const devicePipelineDeps: PipelineDeps = {
  enhanceWorking: enhanceWorkingFile,
  prepare: (uri, cap) => preparePhoto(uri, cap, devicePrepDeps),
  loadImage,
  persistMask: (png) => writeCacheFile(tempName('mask', 'png'), png),
};
