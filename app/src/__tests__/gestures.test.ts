import { GestureController, type GestureHandlers, type OneFingerMode } from '@/editor/gestures';

function rig(mode: OneFingerMode) {
  const log: string[] = [];
  const h: GestureHandlers = {
    onStrokeBegin: (p) => log.push(`sb ${p.x},${p.y}`),
    onStrokeMove: (p) => log.push(`sm ${p.x},${p.y}`),
    onStrokeEnd: () => log.push('se'),
    onStrokeCancel: () => log.push('sc'),
    onShapeBegin: () => log.push('hb'),
    onShapeMove: () => log.push('hm'),
    onShapeEnd: (a, b) => log.push(`he ${a.x},${a.y}-${b.x},${b.y}`),
    onShapeCancel: () => log.push('hc'),
    onTap: (p) => log.push(`tap ${p.x},${p.y}`),
    onDoubleTap: (p) => log.push(`dbl ${p.x},${p.y}`),
    onPan: (dx, dy) => log.push(`pan ${dx},${dy}`),
    onPinch: (a, b) => log.push(`pinch ${(b.dist / a.dist).toFixed(2)}`),
  };
  const c = new GestureController(h);
  c.mode = mode;
  return { c, log };
}
const P = (x: number, y: number) => ({ x, y });

describe('gesture controller', () => {
  it('one finger draws a stroke; a quick touch makes a dab', () => {
    const { c, log } = rig('stroke');
    c.touchStart([P(10, 10)], 0);
    c.touchMove([P(20, 10)], 10);
    c.touchEnd(20);
    expect(log).toEqual(['sb 10,10', 'sm 20,10', 'se']);
    log.length = 0;
    c.touchStart([P(5, 5)], 100);
    c.touchEnd(120);
    expect(log).toEqual(['sb 5,5', 'se']);
  });

  it('a second finger landing mid-stroke cancels the stroke and the rest of the gesture only pans/zooms', () => {
    const { c, log } = rig('stroke');
    c.touchStart([P(10, 10)], 0);
    c.touchMove([P(30, 10)], 10);
    c.touchStart([P(30, 10), P(100, 10)], 20);
    c.touchMove([P(30, 10), P(120, 10)], 30);
    c.touchEnd(40); // all fingers up
    expect(log).toEqual(['sb 10,10', 'sm 30,10', 'sc', expect.stringMatching(/^pinch 1\.2/)]);
    expect(log.some((l) => l === 'se')).toBe(false);
    // after release a new single touch draws again
    log.length = 0;
    c.touchStart([P(1, 1)], 100);
    c.touchEnd(110);
    expect(log).toEqual(['sb 1,1', 'se']);
  });

  it('fingers lifting one at a time never resumes drawing with the remaining finger', () => {
    const { c, log } = rig('stroke');
    c.touchStart([P(0, 0), P(50, 0)], 0);
    c.touchMove([P(0, 0), P(60, 0)], 10);
    c.touchMove([P(5, 5)], 20); // one finger left, but we are still in the multi-touch gesture
    c.touchEnd(30);
    expect(log.filter((l) => l.startsWith('sb') || l.startsWith('sm'))).toEqual([]);
  });

  it('tap mode: taps select, drags do not, double tap is reported', () => {
    const { c, log } = rig('tap');
    c.touchStart([P(40, 40)], 0);
    c.touchEnd(100);
    expect(log).toEqual(['tap 40,40']);
    log.length = 0;
    c.touchStart([P(40, 40)], 1000);
    c.touchMove([P(80, 80)], 1050);
    c.touchEnd(1100);
    expect(log).toEqual([]); // a drag is not a tap
    c.touchStart([P(40, 40)], 2000);
    c.touchEnd(2050);
    c.touchStart([P(42, 41)], 2150);
    c.touchEnd(2200);
    expect(log).toEqual(['tap 40,40', 'dbl 42,41']);
  });

  it('shape mode drags out a shape and ends with both corners; hand mode pans', () => {
    const s = rig('shape');
    s.c.touchStart([P(10, 10)], 0);
    s.c.touchMove([P(12, 11)], 5); // inside the slop: nothing yet
    s.c.touchMove([P(60, 50)], 10);
    s.c.touchEnd(20);
    expect(s.log).toEqual(['hb', 'hm', 'he 10,10-60,50']);
    const p = rig('pan');
    p.c.touchStart([P(0, 0)], 0);
    p.c.touchMove([P(10, 5)], 10);
    p.c.touchMove([P(12, 9)], 20);
    p.c.touchEnd(30);
    expect(p.log).toEqual(['pan 10,5', 'pan 2,4']);
  });

  it('cancel() drops a half-drawn stroke', () => {
    const { c, log } = rig('stroke');
    c.touchStart([P(0, 0)], 0);
    c.cancel();
    expect(log).toEqual(['sb 0,0', 'sc']);
  });
});
