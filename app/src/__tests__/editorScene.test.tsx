/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 */
import { AlphaType, ColorType, drawAsImage, Skia, type SkImage } from '@shopify/react-native-skia';
import { EditorScene, type SceneOverlay } from '@/components/editor/EditorScene';
import { EditorDoc } from '@/editor/doc';
import type { ViewMode } from '@/editor/viewModes';
import { TiledMask } from '@/mask/tiledMask';
import { fitTransform } from '@/scene/viewTransform';
import { objectWithBlob, type Fixture } from '../../test/fixtures';

jest.mock('@shopify/react-native-skia', () => require('@/testing/skiaReal').skiaReal());

const photoOf = (f: Fixture): SkImage =>
  Skia.Image.MakeImage(
    {
      width: f.width,
      height: f.height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    Skia.Data.fromBytes(f.rgba),
    f.width * 4,
  )!;

const f = objectWithBlob(600, 400);
const BOX = { w: 300, h: 200 };

async function shot(
  mode: ViewMode,
  over: Partial<{ overlay: SceneOverlay; compareX: number; doc: EditorDoc }> = {},
) {
  const doc =
    over.doc ?? new EditorDoc('s', photoOf(f), TiledMask.fromFlat(f.truth, f.width, f.height));
  const view = fitTransform(doc.width, doc.height, BOX.w, BOX.h);
  const img = await drawAsImage(
    <EditorScene
      doc={doc}
      rev={doc.rev}
      view={view}
      box={BOX}
      mode={mode}
      color="#33AA55"
      compareX={over.compareX ?? 150}
      overlay={over.overlay ?? {}}
      accent="#FF8A3D"
      danger="#FF0000"
    />,
    { width: BOX.w, height: BOX.h },
  );
  const px = img!.readPixels(0, 0, {
    width: BOX.w,
    height: BOX.h,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  })!;
  const rgba = px instanceof Uint8Array ? px : new Uint8Array(px.buffer);
  const at = (x: number, y: number) =>
    Array.from(rgba.slice((y * BOX.w + x) * 4, (y * BOX.w + x) * 4 + 4));
  return { at, view };
}
// photo (0.4W, 0.5H) is inside the product; (0.82W, 0.5H) is the logo (not in the truth mask); (5,5) is background
const inProduct = { x: 120, y: 100 };
const inLogo = { x: 246, y: 100 };
const corner = { x: 3, y: 3 };

describe('EditorScene renders every view mode (real Skia, offscreen)', () => {
  it('white / black / colour backgrounds show through where the mask is empty', async () => {
    expect((await shot('white')).at(inLogo.x, inLogo.y)).toEqual([255, 255, 255, 255]);
    expect((await shot('black')).at(inLogo.x, inLogo.y)).toEqual([0, 0, 0, 255]);
    expect((await shot('color')).at(inLogo.x, inLogo.y)).toEqual([0x33, 0xaa, 0x55, 255]);
    // the product itself is the (dark) photo pixel in every one of those modes
    const w = await shot('white');
    expect(w.at(inProduct.x, inProduct.y).slice(0, 3)).toEqual([22, 24, 28]);
  });

  it('checkerboards have two tones and the product is on top of them', async () => {
    const s = await shot('checker-light');
    const a = s.at(corner.x, corner.y);
    const b = s.at(corner.x + 14, corner.y);
    expect(a).not.toEqual(b);
    expect(a[0]).toBeGreaterThan(190);
    const d = await shot('checker-dark');
    expect(d.at(corner.x, corner.y)[0]).toBeLessThan(80);
    expect(s.at(inProduct.x, inProduct.y).slice(0, 3)).toEqual([22, 24, 28]);
  });

  it('"removed in red" shows the original photo with the discarded area tinted red', async () => {
    const s = await shot('removed-red');
    const logo = s.at(inLogo.x, inLogo.y); // the logo was removed from the mask: bright photo + red tint
    expect(logo[0]).toBeGreaterThan(logo[1] + 80);
    const kept = s.at(inProduct.x, inProduct.y); // kept area: the photo as is
    expect(kept.slice(0, 3)).toEqual([22, 24, 28]);
  });

  it('"mask only" is white where kept and black elsewhere', async () => {
    const s = await shot('mask');
    expect(s.at(inProduct.x, inProduct.y).slice(0, 3)).toEqual([255, 255, 255]);
    expect(s.at(inLogo.x, inLogo.y).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('before/after splits the screen: original on the left, cut-out on the right', async () => {
    const s = await shot('before-after', { compareX: 260 });
    // left of the divider the photo is untouched even where the mask is empty (corner = grey scene, not checker)
    expect(s.at(corner.x, corner.y).slice(0, 3)).toEqual([120, 122, 128]);
    // right of it the cut-out shows a transparency checker instead of the scene
    const right = s.at(280, 100);
    expect(right.slice(0, 3)).not.toEqual([120, 122, 128]);
    // the logo (bright, x = 246) is left of the divider (260), so the original shows it; the cut-out does not
    expect(s.at(inLogo.x, inLogo.y)[0]).toBeGreaterThan(200);
    const noDivider = await shot('white');
    expect(noDivider.at(inLogo.x, inLogo.y).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('selection tint and a suggestion highlight draw over the cut-out; erasing shows live', async () => {
    const doc = new EditorDoc('s2', photoOf(f), TiledMask.fromFlat(f.modelMask, f.width, f.height));
    doc.selectShape({ kind: 'rect', x: 150, y: 150, w: 100, h: 100 }, 'replace');
    const s = await shot('white', { doc });
    const sel = s.at(100, 100); // photo (200,200): inside the selection and the product
    expect(sel[0]).toBeGreaterThan(40); // orange tint over a dark pixel
    expect(sel[0]).toBeGreaterThan(sel[2] + 20);
    const live = await shot('white', {
      doc,
      overlay: {
        liveStroke: {
          mode: 'erase',
          size: 120,
          softness: 0,
          opacity: 1,
          points: [{ x: 300, y: 200 }],
        },
      },
    });
    expect(live.at(150, 100).slice(0, 3)).toEqual([255, 255, 255]); // product erased under the live stroke
  });
});
