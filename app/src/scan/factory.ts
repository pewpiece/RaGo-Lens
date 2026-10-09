import { devicePrepDeps } from '@/engine/imagePrepDevice';
import { prepareWorkingImage } from '@/engine/imagePrep';
import * as ImageManipulator from 'expo-image-manipulator';
import { ImageFormat } from '@shopify/react-native-skia';
import { loadImage } from '@/lib/loadImage';
import { tempName, writeCacheFile } from '@/lib/files';
import { enhanceForOcr } from './enhance';
import { MlKitOcrEngine } from './mlkitEngine';
import { MockOcrEngine } from './mockOcr';
import type { ScanDeps } from './pipeline';
import type { ScanSaveDeps } from './saveScan';
import type { OcrEngine } from './types';

let mlkit: MlKitOcrEngine | null = null;

export function getOcrEngine(useMock: boolean): OcrEngine {
  if (useMock) return new MockOcrEngine({ delayMs: 500 });
  if (!mlkit) mlkit = new MlKitOcrEngine();
  return mlkit;
}

export const deviceScanDeps: ScanDeps = {
  prepare: (uri, cap) => prepareWorkingImage(uri, cap, devicePrepDeps),
  async enhance(uri) {
    const out = enhanceForOcr(await loadImage(uri));
    return writeCacheFile(tempName('ocr', 'jpg'), out.encodeToBytes(ImageFormat.JPEG, 92));
  },
};

export const deviceSaveDeps: ScanSaveDeps = {
  async makeThumb(photoUri) {
    const r = await ImageManipulator.manipulateAsync(photoUri, [{ resize: { width: 360 } }], {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return r.uri;
  },
};
