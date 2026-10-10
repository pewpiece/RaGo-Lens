import { LEVEL_TOLERANCE_DEG, ShakeMeter, levelFromAccel } from '@/capture/level';
import { BLUR_EDGE_LIMIT, assessPhoto } from '@/capture/quality';

const deg = (d: number) => (d * Math.PI) / 180;

describe('level indicator', () => {
  it('upright: reads the roll angle and is level within 1.5 degrees (either sign convention)', () => {
    const r = levelFromAccel(Math.sin(deg(10)), Math.cos(deg(10)), 0);
    expect(r.mode).toBe('upright');
    expect(r.angle).toBeCloseTo(10, 6);
    expect(r.level).toBe(false);
    expect(levelFromAccel(0, 1, 0).level).toBe(true);
    expect(levelFromAccel(0, -1, 0).level).toBe(true); // iOS-style signs
    expect(levelFromAccel(Math.sin(deg(-1)), Math.cos(deg(1)), 0).level).toBe(true);
    expect(levelFromAccel(Math.sin(deg(2)), Math.cos(deg(2)), 0).level).toBe(false);
    expect(LEVEL_TOLERANCE_DEG).toBe(1.5);
  });
  it('flat (shooting down at a table): tilt from horizontal and a bubble that moves toward the high side', () => {
    const level = levelFromAccel(0, 0, 1);
    expect(level.mode).toBe('flat');
    expect(level.level).toBe(true);
    const tilted = levelFromAccel(Math.sin(deg(5)), 0, Math.cos(deg(5)));
    expect(tilted.mode).toBe('flat');
    expect(tilted.angle).toBeCloseTo(5, 6);
    expect(tilted.level).toBe(false);
    expect(tilted.bubbleX).toBeGreaterThan(0.4);
    expect(levelFromAccel(0, 0, -1).mode).toBe('flat');
    expect(levelFromAccel(0, 0, 0).level).toBe(true); // no data: do not nag
  });
  it('a steady hand is not shaky, a shaking one is', () => {
    const steady = new ShakeMeter();
    for (let i = 0; i < 8; i++) steady.push(0.01 * Math.sin(i), 1, 0);
    expect(steady.shaky).toBe(false);
    const shaking = new ShakeMeter();
    for (let i = 0; i < 8; i++) shaking.push(0, 1 + (i % 2 ? 0.3 : -0.3), 0.2);
    expect(shaking.shaky).toBe(true);
    expect(new ShakeMeter().shaky).toBe(false);
  });
});

/** Square product on a surface; `blur` spreads the edge over that many pixels. */
function scene(w: number, h: number, product: number, surface: number, blur: number) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.min(x - w * 0.25, w * 0.75 - x, y - h * 0.25, h * 0.75 - y); // signed distance inside the product box
      const t = blur <= 0 ? (d >= 0 ? 1 : 0) : Math.min(1, Math.max(0, d / blur + 0.5));
      const v = Math.round(surface + (product - surface) * t);
      rgba.set([v, v, v, 255], (y * w + x) * 4);
    }
  return rgba;
}

describe('photo quality tips', () => {
  const W = 256;
  const H = 256;
  it('a crisp edge passes, the same photo blurred is flagged', () => {
    const sharp = assessPhoto(scene(W, H, 60, 200, 0), W, H);
    const blurred = assessPhoto(scene(W, H, 60, 200, 28), W, H);
    console.log(
      `edge sharpness: crisp ${sharp.edgeSharpness}, blurred ${blurred.edgeSharpness} (limit ${BLUR_EDGE_LIMIT})`,
    );
    expect(sharp.blurry).toBe(false);
    expect(blurred.blurry).toBe(true);
    expect(blurred.tips.join(' ')).toMatch(/blurry/);
  });
  it('a dark product on a dark surface triggers the "place it on a light surface" tip; a light one the reverse', () => {
    const dark = assessPhoto(scene(W, H, 15, 40, 0), W, H);
    expect(dark.centreDark).toBe(true);
    expect(dark.tips).toContain('Dark product? Place it on a light surface.');
    const light = assessPhoto(scene(W, H, 245, 200, 0), W, H);
    expect(light.centreLight).toBe(true);
    expect(light.tips.join(' ')).toMatch(/Light product\?/);
    const fine = assessPhoto(scene(W, H, 90, 210, 0), W, H);
    expect(fine.tips).toEqual([]);
  });
  it('a very dark photo is told to find better light', () => {
    const q = assessPhoto(scene(W, H, 5, 12, 0), W, H);
    expect(q.tooDark).toBe(true);
    expect(q.tips.join(' ')).toMatch(/very dark/);
  });
});
