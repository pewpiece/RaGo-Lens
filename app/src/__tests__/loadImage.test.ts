/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, Skia } from '@shopify/react-native-skia';
import { loadImage } from '@/lib/loadImage';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());
jest.mock('expo-file-system', () => require('@/testing/fakeFileSystem').fakeFileSystem());

const fs = jest.requireMock('expo-file-system') as {
  File: new (...p: unknown[]) => { create(): void; write(b: Uint8Array): void };
};

it('decodes an image file from local storage', async () => {
  const px = new Uint8Array(4 * 4 * 4).fill(255);
  const png = Skia.Image.MakeImage(
    { width: 4, height: 4, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(px),
    16,
  )!.encodeToBytes();
  const f = new fs.File('file:///cache/a.png');
  f.create();
  f.write(png);
  const img = await loadImage('file:///cache/a.png');
  expect([img.width(), img.height()]).toEqual([4, 4]);
});

it('fails fast with a clear error for a missing file (never hangs)', async () => {
  await expect(loadImage('file:///cache/missing.jpg')).rejects.toThrow(/file not found/);
});

it('fails with a clear error for corrupt image data', async () => {
  const f = new fs.File('file:///cache/bad.jpg');
  f.create();
  f.write(new Uint8Array([1, 2, 3, 4]));
  await expect(loadImage('file:///cache/bad.jpg')).rejects.toThrow(/Could not load image/);
});
