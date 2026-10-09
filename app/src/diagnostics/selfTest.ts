import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import { devicePipelineDeps, getEngine } from '@/engine/factory';
import { runCutout } from '@/engine/pipeline';
import { imageFromBytes, readAlpha } from '@/engine/skiaOps';
import { DEFAULT_EXPORT_OPTIONS } from '@/export/options';
import { pngHasAlphaChannel } from '@/export/png';
import { renderExport } from '@/scene/exportRender';
import { deviceScanDeps, getOcrEngine } from '@/scan/factory';
import { runScan } from '@/scan/pipeline';

// Stored as .bin on purpose: for image types Expo returns only a drawable resource NAME on Android (not a file path),
// which image decoders cannot open. Non-image assets are copied to a real file, which we then copy to a .jpg path.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SAMPLE = require('../../assets/samples/sample.bin') as number;
// Printed page with a heading, a bullet list, a numbered list and a sentence.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SCAN_SAMPLE = require('../../assets/samples/scan-sample.bin') as number;

async function sampleToJpg(module: number, name: string): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error(`${name} has no local file`);
  const jpg = new File(Paths.cache, name);
  if (jpg.exists) jpg.delete();
  new File(asset.localUri).copySync(jpg);
  return jpg.uri;
}

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
    if (!asset.localUri) throw new Error('sample photo has no local file');
    const jpg = new File(Paths.cache, 'selftest-sample.jpg');
    if (jpg.exists) jpg.delete();
    new File(asset.localUri).copySync(jpg);
    const uri = jpg.uri;
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

    const cutoutOk = result.foundObject && hasAlphaChannel && opaque > 0 && clear > 0;
    log(`cut-out check: ${cutoutOk ? 'ok' : 'FAILED'}`);

    // Scan: real ML Kit text recognition on the bundled printed page.
    const scanUri = await sampleToJpg(SCAN_SAMPLE, 'selftest-scan.jpg');
    const tScan = Date.now();
    const scan = await runScan(
      { uri: scanUri, script: 'latin', engine: getOcrEngine(false) },
      deviceScanDeps,
    );
    log(`scan done in ${((Date.now() - tScan) / 1000).toFixed(1)}s, ${scan.charCount} characters`);
    log(`scan text: ${scan.plain.replace(/\n+/g, ' / ').slice(0, 160)}`);
    const low = scan.plain.toLowerCase();
    const scanOk = ['shopping', 'milk', 'eggs', 'bread', 'wash', 'mother'].every((w) =>
      low.includes(w),
    );
    log(`scan check: ${scanOk ? 'ok' : 'FAILED (expected words missing)'}`);

    const passed = cutoutOk && scanOk;
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
