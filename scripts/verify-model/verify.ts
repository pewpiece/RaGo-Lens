/**
 * Usage: npm install && npx tsx verify.ts <input.jpg> [out.png]
 * Runs the app's real pre-processing + post-processing around the bundled model (WASM runtime) and writes a
 * transparent PNG so you can eyeball the result. This validates model I/O names, normalisation and mask
 * post-processing on a desktop. It does NOT validate the Android runtime, speed or memory.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web';
import { MODEL_INPUT_SIZE, rgbaToNchw } from '../../app/src/engine/preprocess';
import { applyMaskToRgba, maskBounds, postprocessMask, resizeMaskBilinear } from '../../app/src/engine/postprocess';

async function main() {
const [input, output = 'cutout.png'] = process.argv.slice(2);
if (!input) throw new Error('usage: tsx verify.ts <input.jpg> [out.png]');

const img = jpeg.decode(readFileSync(input), { useTArray: true, formatAsRGBA: true });
const N = MODEL_INPUT_SIZE;
// small-model-input resize (area-ish via bilinear); the app uses Skia for this step
const small = resizeRgba(img.data, img.width, img.height, N, N);

const session = await ort.InferenceSession.create(readFileSync(join(__dirname, '../../app/assets/models/u2netp.onnx')));
const inputName = session.inputNames[0]!;
const t0 = performance.now();
const out = await session.run({ [inputName]: new ort.Tensor('float32', rgbaToNchw(small, N, N), [1, 3, N, N]) });
const ms = performance.now() - t0;
const first = out[session.outputNames[0]!]!;
console.log(`input=${inputName} outputs=${session.outputNames.length} firstOutputDims=${JSON.stringify(first.dims)} (desktop WASM: ${ms.toFixed(0)} ms)`);

const mask = postprocessMask(first.data as Float32Array, N, N);
const full = resizeMaskBilinear(mask.alpha, N, N, img.width, img.height);
const rgba = applyMaskToRgba(img.data as unknown as Uint8Array, full);
const png = new PNG({ width: img.width, height: img.height });
png.data = Buffer.from(rgba);
writeFileSync(output, PNG.sync.write(png));

const fg = mask.alpha.reduce((n, v) => n + (v > 127 ? 1 : 0), 0) / mask.alpha.length;
console.log(`foreground fraction=${(fg * 100).toFixed(1)}% bounds=${JSON.stringify(maskBounds(mask.alpha, N, N))}`);
console.log(`wrote ${output} (${img.width}x${img.height}, RGBA)`);
const rows: string[] = [];
for (let y = 0; y < N; y += 10) {
  let r = '';
  for (let x = 0; x < N; x += 5) r += ' .:-=+*#%@'[Math.min(9, Math.floor(mask.alpha[y * N + x]! / 25.6))];
  rows.push(r);
}
console.log(rows.join('\n'));

}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

function resizeRgba(src: Uint8Array, sw: number, sh: number, dw: number, dh: number) {
  const o = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5, fy = ((y + 0.5) * sh) / dh - 0.5;
      const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy));
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const tx = Math.max(0, fx - x0), ty = Math.max(0, fy - y0);
      for (let c = 0; c < 4; c++) {
        const a = src[(y0 * sw + x0) * 4 + c]! * (1 - tx) + src[(y0 * sw + x1) * 4 + c]! * tx;
        const b = src[(y1 * sw + x0) * 4 + c]! * (1 - tx) + src[(y1 * sw + x1) * 4 + c]! * tx;
        o[(y * dw + x) * 4 + c] = a * (1 - ty) + b * ty;
      }
    }
  return o;
}
