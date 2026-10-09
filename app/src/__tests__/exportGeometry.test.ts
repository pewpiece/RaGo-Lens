import { computeExportGeometry } from '@/scene/exportGeometry';
import { pngColorType, pngHasAlphaChannel, isPng } from '@/export/png';
import { deflateSync } from 'node:zlib';

const base = {
  autoCrop: true,
  paddingPercent: 10,
  size: 'original' as const,
  background: 'transparent' as const,
};

describe('computeExportGeometry', () => {
  it('exports the full image when auto-crop is off', () => {
    const g = computeExportGeometry(
      800,
      600,
      { left: 100, top: 100, right: 200, bottom: 200 },
      { ...base, autoCrop: false },
    );
    expect(g.crop).toEqual({ left: 0, top: 0, right: 800, bottom: 600 });
    expect([g.outWidth, g.outHeight, g.scale]).toEqual([800, 600, 1]);
  });
  it('crops to the object plus padding (percent of the longer side)', () => {
    const g = computeExportGeometry(
      800,
      600,
      { left: 100, top: 100, right: 300, bottom: 200 },
      base,
    );
    expect(g.crop).toEqual({ left: 80, top: 80, right: 320, bottom: 220 }); // pad = 20px
    expect([g.outWidth, g.outHeight]).toEqual([240, 140]);
  });
  it('lets padding extend beyond the photo edge when the object touches it', () => {
    const g = computeExportGeometry(100, 100, { left: 0, top: 0, right: 100, bottom: 100 }, base);
    expect(g.crop.left).toBe(-10);
    expect(g.crop.right).toBe(110);
  });
  it('caps the long edge to 2048/1024 but never upscales', () => {
    const big = computeExportGeometry(4000, 3000, null, { ...base, size: 2048 });
    expect([big.outWidth, big.outHeight]).toEqual([2048, 1536]);
    const small = computeExportGeometry(500, 400, null, { ...base, size: 2048 });
    expect([small.scale, small.outWidth]).toEqual([1, 500]);
    expect(computeExportGeometry(4000, 3000, null, { ...base, size: 1024 }).outWidth).toBe(1024);
  });
  it('falls back to the full image when no object was found', () => {
    expect(computeExportGeometry(10, 10, null, base).crop).toEqual({
      left: 0,
      top: 0,
      right: 10,
      bottom: 10,
    });
  });
  it('adds room for a shadow', () => {
    const plain = computeExportGeometry(
      800,
      600,
      { left: 100, top: 100, right: 300, bottom: 200 },
      base,
    );
    const shadow = computeExportGeometry(
      800,
      600,
      { left: 100, top: 100, right: 300, bottom: 200 },
      { ...base, background: 'shadow' },
    );
    expect(shadow.outWidth).toBeGreaterThan(plain.outWidth);
    expect(shadow.shadowBlur).toBeGreaterThan(0);
    expect(plain.shadowBlur).toBe(0);
  });
});

// minimal PNG builder (header + chunks) to test colour-type detection without any image library
function chunk(type: string, data: Uint8Array) {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  return [...len, ...Buffer.from(type), ...data, 0, 0, 0, 0]; // CRC not validated by our parser
}
function fakePng(colorType: number, extra: [string, number[]][] = []) {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 2);
  new DataView(ihdr.buffer).setUint32(4, 2);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const idat = deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk('IHDR', ihdr),
    ...extra.flatMap(([t, d]) => chunk(t, Uint8Array.from(d))),
    ...chunk('IDAT', idat),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}

describe('PNG alpha detection', () => {
  it('detects RGBA and grey+alpha colour types', () => {
    expect(pngHasAlphaChannel(fakePng(6))).toBe(true);
    expect(pngHasAlphaChannel(fakePng(4))).toBe(true);
    expect(pngColorType(fakePng(6))).toBe(6);
  });
  it('rejects RGB / grey / palette without tRNS', () => {
    expect(pngHasAlphaChannel(fakePng(2))).toBe(false);
    expect(pngHasAlphaChannel(fakePng(0))).toBe(false);
    expect(pngHasAlphaChannel(fakePng(3, [['PLTE', [0, 0, 0]]]))).toBe(false);
  });
  it('accepts palette PNGs that carry a tRNS chunk', () => {
    expect(
      pngHasAlphaChannel(
        fakePng(3, [
          ['PLTE', [0, 0, 0]],
          ['tRNS', [0]],
        ]),
      ),
    ).toBe(true);
  });
  it('rejects non-PNG data (e.g. a JPEG) and truncated files', () => {
    expect(
      pngHasAlphaChannel(
        new Uint8Array([
          0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0,
        ]),
      ),
    ).toBe(false);
    expect(pngHasAlphaChannel(new Uint8Array(5))).toBe(false);
    expect(isPng(fakePng(6))).toBe(true);
    expect(isPng(new Uint8Array(40))).toBe(false);
  });
});
