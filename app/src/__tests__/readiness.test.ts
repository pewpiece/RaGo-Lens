import { DEFAULT_EDIT_STATE } from '@/edit/editState';
import { laplacianVariance, runChecks, worst, type Analysis } from '@/readiness/checks';
import { SEED_PRESETS } from '@/presets/presets';

const preset = SEED_PRESETS.find((p) => p.id === 'square-white-2000')!; // white, fill 0.75-0.95, 2000x2000

const N = 200;
/** A product rectangle with the given texture on a white canvas. */
function make(
  over: Partial<{
    box: [number, number, number, number];
    texture: 'sharp' | 'blur' | 'flat' | 'white';
    shadowToBorder: boolean;
  }> = {},
): Analysis {
  const [x0, y0, x1, y1] = over.box ?? [20, 20, 180, 180];
  const rgba = new Uint8Array(N * N * 4);
  const alpha = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) rgba.set([255, 255, 255, 255], i * 4);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * N + x;
      alpha[i] = 255;
      let v = 90;
      if (over.texture === 'sharp') v = (x + y) % 4 < 2 ? 40 : 200; // fine checker: lots of edges
      if (over.texture === 'blur') v = 120 + 6 * Math.sin((x + y) / 12); // smooth gradient
      if (over.texture === 'white') v = 255;
      rgba.set([v, v, v, 255], i * 4);
    }
  if (over.shadowToBorder)
    for (let y = 195; y < N; y++)
      for (let x = 0; x < N; x++) rgba.set([200, 200, 200, 255], (y * N + x) * 4);
  return {
    w: N,
    h: N,
    rgba,
    productAlpha: alpha,
    outWidth: 2000,
    outHeight: 2000,
    upscale: 0.9,
    background: { kind: 'color', color: '#FFFFFF' },
    format: 'jpeg',
    fileBytes: 800 * 1024,
    cleanup: { specks: 0, blobs: 0, holes: 0, pinholes: 0 },
    framingFix: { ...DEFAULT_EDIT_STATE.transform },
  };
}
const by = (checks: ReturnType<typeof runChecks>, id: string) => checks.find((c) => c.id === id)!;

describe('readiness checks', () => {
  it('a good picture passes everything', () => {
    const c = runChecks(make({ box: [14, 14, 186, 186], texture: 'sharp' }), preset);
    expect(c.filter((x) => x.status !== 'pass').map((x) => `${x.id}:${x.detail}`)).toEqual([]);
    expect(worst(c)).toBe('pass');
  });

  it('fill ratio: too small warns with a one-tap "centre and scale" fix; inside the range passes', () => {
    const small = by(
      runChecks(make({ box: [70, 70, 130, 130], texture: 'sharp' }), preset),
      'fill',
    );
    expect(small.status).toBe('warn');
    expect(small.fix?.label).toMatch(/Centre and scale to 85%/);
    expect(small.fix?.action.kind).toBe('transform');
    expect(
      by(runChecks(make({ box: [14, 14, 186, 186], texture: 'sharp' }), preset), 'fill').status,
    ).toBe('pass');
  });

  it('centring and margins: off-centre warns, touching the edge fails', () => {
    expect(
      by(runChecks(make({ box: [10, 40, 150, 160], texture: 'sharp' }), preset), 'centre').status,
    ).toBe('warn');
    const edge = by(
      runChecks(make({ box: [0, 20, 180, 180], texture: 'sharp' }), preset),
      'centre',
    );
    expect(edge.status).toBe('fail');
    expect(edge.fix).toBeDefined();
  });

  it('background purity: a shadow reaching the border is flagged', () => {
    expect(by(runChecks(make({ texture: 'sharp' }), preset), 'background').status).toBe('pass');
    const bad = by(
      runChecks(make({ texture: 'sharp', shadowToBorder: true }), preset),
      'background',
    );
    expect(bad.status).not.toBe('pass');
  });

  it('sharpness (variance of the Laplacian): fine detail passes, a smooth blur fails, a flat colour is not judged', () => {
    const sharp = laplacianVariance(make({ texture: 'sharp' }));
    const blurred = laplacianVariance(make({ texture: 'blur' }));
    console.log(
      `laplacian variance: sharp ${sharp.variance.toFixed(0)}, blurred ${blurred.variance.toFixed(2)}`,
    );
    expect(sharp.variance).toBeGreaterThan(40 * 5);
    expect(blurred.variance).toBeLessThan(8);
    expect(by(runChecks(make({ texture: 'sharp' }), preset), 'sharpness').status).toBe('pass');
    expect(by(runChecks(make({ texture: 'blur' }), preset), 'sharpness').status).toBe('pass'); // low spread: treated as flat
    // a blurry photo of a textured product: moderate spread, almost no high frequencies
    const a = make({ texture: 'sharp' });
    for (let i = 0; i < N * N; i++) {
      const y = Math.floor(i / N);
      const x = i % N;
      if (a.productAlpha[i])
        a.rgba.fill(120 + Math.round(40 * Math.sin(x / 9) * Math.cos(y / 11)), i * 4, i * 4 + 3);
    }
    expect(by(runChecks(a, preset), 'sharpness').status).toBe('fail');
    expect(by(runChecks(make({ texture: 'flat' }), preset), 'sharpness').detail).toMatch(
      /flat colour/,
    );
  });

  it('exposure: a mostly blown-out product warns', () => {
    expect(by(runChecks(make({ texture: 'white' }), preset), 'exposure').status).toBe('warn');
    expect(by(runChecks(make({ texture: 'sharp' }), preset), 'exposure').status).toBe('pass');
  });

  it('leftover pieces and unfilled holes come from the clean-up analysis and point to the editor', () => {
    const a = {
      ...make({ texture: 'sharp' }),
      cleanup: { specks: 2, blobs: 1, holes: 3, pinholes: 1 },
    };
    const c = runChecks(a, preset);
    expect(by(c, 'leftovers').status).toBe('warn');
    expect(by(c, 'holes').status).toBe('warn');
    expect(by(c, 'holes').fix?.action.kind).toBe('editor');
  });

  it('transparency: a transparent preset needs real alpha and a format that can carry it', () => {
    const tp = SEED_PRESETS.find((p) => p.id === 'transparent-png')!;
    const a = make({ texture: 'sharp' });
    a.background = { kind: 'transparent' };
    a.format = 'png';
    for (let i = 0; i < N * N; i++) if (!a.productAlpha[i]) a.rgba[i * 4 + 3] = 0;
    expect(by(runChecks(a, tp), 'transparency').status).toBe('pass');
    const flat = { ...a, rgba: a.rgba.map((v, i) => (i % 4 === 3 ? 255 : v)) };
    expect(by(runChecks(flat, tp), 'transparency').status).toBe('fail');
    expect(by(runChecks({ ...a, format: 'jpeg' }, tp), 'transparency').fix?.action).toEqual({
      kind: 'format',
      format: 'png',
    });
  });

  it('resolution and file size against the preset', () => {
    const a = make({ texture: 'sharp' });
    expect(
      by(runChecks({ ...a, outWidth: 1200, outHeight: 1200 }, preset), 'resolution').status,
    ).toBe('fail');
    expect(by(runChecks({ ...a, upscale: 1.6 }, preset), 'resolution').status).toBe('warn');
    expect(by(runChecks(a, preset), 'resolution').status).toBe('pass');
    const limited = { ...preset, maxFileKB: 500 };
    expect(by(runChecks(a, limited), 'filesize').status).toBe('fail');
    expect(by(runChecks({ ...a, fileBytes: 300 * 1024 }, limited), 'filesize').status).toBe('pass');
  });
});
