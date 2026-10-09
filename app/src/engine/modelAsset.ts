import { Asset } from 'expo-asset';
import { CutoutError } from './types';

// Bundled by Metro (see metro.config.js: `onnx` is an asset extension). The file is fetched and
// SHA-256-verified by scripts/fetch-model.sh before bundling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_MODULE = require('../../assets/models/u2netp.onnx') as number;

let cached: Promise<string> | null = null;

/** Local file path (no scheme) of the bundled model. Release builds copy it out of the APK resources. */
export function bundledModelPath(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      try {
        const asset = Asset.fromModule(MODEL_MODULE);
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) throw new Error('asset has no local URI');
        return uri.replace(/^file:\/\//, '');
      } catch (e) {
        throw new CutoutError(
          'model-missing',
          'The segmentation model is missing from this build. Reinstall the app.',
          e,
        );
      }
    })();
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
