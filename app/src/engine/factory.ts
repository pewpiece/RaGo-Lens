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
import { File } from 'expo-file-system';
import { decodeMaskPng } from './remoteDecode';
import {
  DEFAULT_REMOTE,
  FallbackEngine,
  RemoteEngine,
  isLanUrl,
  lanFetch,
  normalizeBaseUrl,
} from './remoteEngine';

let onnx: OnnxSegmentationEngine | null = null;

/** The on-device engine, kept for reuse between photos. */
function localEngine(): ImageEngine {
  if (!onnx) {
    onnx = new OnnxSegmentationEngine({
      ort: loadOrt,
      modelPath: bundledModelPath,
      sampleRgba: async (input, size) => sampleRgba(await loadImage(input.uri), size, size),
    });
  }
  return onnx;
}

export interface RemoteSettingsLike {
  enabled: boolean;
  baseUrl: string;
  token: string;
  timeoutSec: number;
}

/**
 * The active engine. Normally the on-device one. If the user switched on the HD engine and gave it a LAN address and a token,
 * that one is tried first and the on-device engine quietly takes over when it fails.
 */
export function getEngine(useMock: boolean, remote?: RemoteSettingsLike): ImageEngine {
  if (useMock) return new MockEngine({ delayMs: 600 });
  const local = localEngine();
  if (
    remote?.enabled &&
    remote.baseUrl &&
    remote.token &&
    isLanUrl(normalizeBaseUrl(remote.baseUrl))
  ) {
    return new FallbackEngine(remoteEngineFor(remote), local);
  }
  return local;
}

/** The HD engine client for the given settings (also used by "Test connection"). */
export function remoteEngineFor(remote: RemoteSettingsLike): RemoteEngine {
  return new RemoteEngine(
    {
      ...DEFAULT_REMOTE,
      baseUrl: remote.baseUrl,
      token: remote.token,
      timeoutMs: remote.timeoutSec * 1000,
    },
    {
      fetch: lanFetch,
      readBytes: async (uri) => new File(uri).bytes(),
      decodeMask: decodeMaskPng,
    },
  );
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
