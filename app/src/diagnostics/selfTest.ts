import { Asset } from 'expo-asset';
import { devicePipelineDeps, getEngine } from '@/engine/factory';
import { runCutout } from '@/engine/pipeline';
import { imageFromBytes, readAlpha } from '@/engine/skiaOps';
import { DEFAULT_EXPORT_OPTIONS } from '@/export/options';
import { pngHasAlphaChannel } from '@/export/png';
import { renderExport } from '@/scene/exportRender';

const SAMPLE = require('../../assets/samples/sample.jpg') as number;

export interface SelfTestResult {
  passed: boolean;
  lines: string[];
}

/**
 * End-to-end check of everything native on THIS device: photo prep, ONNX Runtime inference with the real model,
 * Skia compositing and the transparent PNG export. Every line is also written to the console as `SELFTEST ...`
 * so CI (adb logcat) and a connected computer can read it.
 */
export async function runSelfTest(onLine?: (line: string) => void): Promise<SelfTestResult> {
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(`SELFTEST ${s}`);
    onLine?.(s);
  };
  const t0 = Date.now();
  const lap = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    log('start');
    const asset = Asset.fromModule(SAMPLE);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    log(`sample photo ready ${lap()}`);

    const engine = getEngine(false);
    const tInfer = Date.now();
    const result = await runCutout({ uri, cap: 1024, engine }, devicePipelineDeps);
    log(
      `cut-out done in ${((Date.now() - tInfer) / 1000).toFixed(1)}s (${result.width}x${result.height}, engine ${result.engineId})`,
    );
    log(`object found: ${result.foundObject}`);

    const out = await renderExport(
      {
        original: result.original,
        maskLayer: result.maskLayer,
        strokes: [],
        width: result.width,
        height: result.height,
      },
      { ...DEFAULT_EXPORT_OPTIONS, background: 'transparent', autoCrop: false, size: 'original' },
    );
    const hasAlphaChannel = pngHasAlphaChannel(out.png);
    const alpha = readAlpha(imageFromBytes(out.png));
    let opaque = 0;
    let clear = 0;
    for (let i = 0; i < alpha.length; i += 7) {
      if (alpha[i]! > 240) opaque++;
      else if (alpha[i]! < 15) clear++;
    }
    const sampled = Math.ceil(alpha.length / 7);
    log(`export PNG ${out.width}x${out.height}, alpha channel: ${hasAlphaChannel}`);
    log(
      `opaque ${((opaque / sampled) * 100).toFixed(1)}%  transparent ${((clear / sampled) * 100).toFixed(1)}%`,
    );

    const passed = result.foundObject && hasAlphaChannel && opaque > 0 && clear > 0;
    log(passed ? `PASS ${lap()}` : `FAIL ${lap()}`);
    return { passed, lines };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const cause =
      e instanceof Error && 'cause' in e && e.cause
        ? ` | cause: ${String((e.cause as Error)?.message ?? e.cause)}`
        : '';
    log(`ERROR ${msg}${cause}`);
    log(`FAIL ${lap()}`);
    return { passed: false, lines };
  }
}
