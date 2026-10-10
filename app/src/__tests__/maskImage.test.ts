/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { ImageFormat } from '@shopify/react-native-skia';
import { imageFromBytes, readAlpha } from '@/engine/skiaOps';
import { maskFromImage, maskToImage, TileImageCache, tileImage } from '@/mask/maskImage';
import { TiledMask } from '@/mask/tiledMask';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

describe('mask <-> Skia image', () => {
  const W = 1100;
  const H = 600;
  const make = () => {
    const m = new TiledMask(W, H);
    const a = new Uint8Array(W * H);
    for (let y = 100; y < 500; y++)
      for (let x = 100; x < 1000; x++) a[y * W + x] = (x * 3 + y * 5) % 256;
    m.writeRegion({ x: 0, y: 0, w: W, h: H }, a);
    return { m, a };
  };

  it('survives a trip through an 8-bit PNG file exactly', () => {
    const { m, a } = make();
    const png = maskToImage(m).encodeToBytes(ImageFormat.PNG, 100)!;
    const back = maskFromImage(imageFromBytes(png));
    expect([back.width, back.height]).toEqual([W, H]);
    expect(Array.from(back.toFlat())).toEqual(Array.from(a));
  });

  it('draws tiles and re-uploads only the edited one', () => {
    const { m } = make();
    const cache = new TileImageCache(m);
    const first = cache.get(0);
    expect(cache.get(0)).toBe(first);
    m.setTile(0, new Uint8Array(512 * 512).fill(3));
    expect(cache.get(0)).not.toBe(first);
    expect(readAlpha(tileImage(m, 0))[10]).toBe(3);
    expect(cache.isEmpty(m.tileIndex(2, 1))).toBe(true);
  });
});
