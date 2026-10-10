import { rleDecode, rleEncode } from '@/mask/rle';
import { TILE, TiledMask } from '@/mask/tiledMask';
import { MaskHistory } from '@/mask/history';
import { DEFAULT_EDIT_STATE, parseEditState, serializeEditState } from '@/edit/editState';

function lcg(seed: number) {
  let s = seed;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

describe('RLE', () => {
  it('round-trips random, flat and mixed data exactly', () => {
    const r = lcg(1);
    const random = Uint8Array.from({ length: 5000 }, () => Math.floor(r() * 256));
    const flat = new Uint8Array(262144).fill(255);
    const mixed = new Uint8Array(100000);
    mixed.fill(7, 300, 90000);
    for (const d of [random, flat, mixed, new Uint8Array(1), new Uint8Array(0)]) {
      expect(Array.from(rleDecode(rleEncode(d), d.length))).toEqual(Array.from(d));
    }
  });
  it('a uniform 512x512 tile costs a handful of bytes', () => {
    expect(rleEncode(new Uint8Array(TILE * TILE).fill(255)).length).toBeLessThanOrEqual(5);
  });
  it('rejects a corrupt stream', () => {
    expect(() => rleDecode(Uint8Array.from([5, 10]), 4)).toThrow();
  });
});

describe('TiledMask', () => {
  const W = 1100;
  const H = 700; // 3 x 2 tiles, ragged edges
  const flat = () => {
    const r = lcg(3);
    const a = new Uint8Array(W * H);
    for (let y = 300; y < 650; y++)
      for (let x = 200; x < 1000; x++) a[y * W + x] = 128 + Math.floor(r() * 120);
    return a;
  };

  it('splits into tiles with smaller edge tiles and reassembles identically', () => {
    const f = flat();
    const m = TiledMask.fromFlat(f, W, H);
    expect([m.tilesX, m.tilesY, m.tileCount]).toEqual([3, 2, 6]);
    expect(m.tileRect(2)).toEqual({ x: 1024, y: 0, w: 76, h: 512 });
    expect(m.tileRect(5)).toEqual({ x: 1024, y: 512, w: 76, h: 188 });
    expect(Array.from(m.toFlat())).toEqual(Array.from(f));
    expect(m.get(500, 400)).toBe(f[400 * W + 500]);
    expect(m.get(-1, 5)).toBe(0);
  });

  it('empty tiles are free: only tiles with varied data use memory', () => {
    const m = TiledMask.fromFlat(flat(), W, H);
    expect(m.uniformValue(2)).toBe(0); // far right tile, untouched
    expect(m.memoryBytes()).toBeLessThan(W * H);
    expect(new TiledMask(4000, 3000).memoryBytes()).toBe(0);
  });

  it('writeRegion / readRegion are exact across tile borders', () => {
    const m = new TiledMask(W, H);
    const rect = { x: 500, y: 500, w: 100, h: 60 }; // straddles the tile corner at (512,512)
    const data = Uint8Array.from({ length: rect.w * rect.h }, (_, i) => (i * 7) % 251);
    m.writeRegion(rect, data);
    expect(Array.from(m.readRegion(rect))).toEqual(Array.from(data));
    expect(m.get(499, 500)).toBe(0);
    expect(m.get(512, 512)).toBe(data[12 * 100 + 12]);
    expect(m.tilesIn(rect)).toHaveLength(4);
  });
});

describe('MaskHistory (per-tile diffs)', () => {
  const W = 1100;
  const H = 700;
  const paint = (
    m: TiledMask,
    h: MaskHistory,
    label: string,
    rect: { x: number; y: number; w: number; h: number },
    v: number,
  ) => {
    const s = h.begin(m, label);
    for (const t of m.tilesIn(rect)) s.touch(t);
    m.writeRegion(rect, new Uint8Array(rect.w * rect.h).fill(v));
    return s.commit();
  };

  it('undo and redo reproduce exact mask states, 60 random edits, 50-step limit', () => {
    const m = new TiledMask(W, H);
    const h = new MaskHistory();
    const r = lcg(9);
    const states: Uint8Array[] = [m.toFlat()];
    for (let i = 0; i < 60; i++) {
      const rect = {
        x: Math.floor(r() * (W - 200)),
        y: Math.floor(r() * (H - 200)),
        w: 20 + Math.floor(r() * 180),
        h: 20 + Math.floor(r() * 180),
      };
      paint(m, h, `e${i}`, rect, 1 + Math.floor(r() * 254));
      states.push(m.toFlat());
    }
    expect(h.size).toBe(50);
    // walk all the way back: states[60] -> states[10] (the oldest kept step restores states[10])
    for (let i = 59; i >= 10; i--) {
      h.undo(m);
      expect(Array.from(m.toFlat())).toEqual(Array.from(states[i]!));
    }
    expect(h.canUndo).toBe(false);
    expect(h.undo(m)).toEqual([]);
    // and forward again
    for (let i = 11; i <= 60; i++) {
      h.redo(m);
      expect(Array.from(m.toFlat())).toEqual(Array.from(states[i]!));
    }
    expect(h.canRedo).toBe(false);
  });

  it('a new edit after undo discards the redo branch', () => {
    const m = new TiledMask(600, 600);
    const h = new MaskHistory();
    paint(m, h, 'a', { x: 0, y: 0, w: 10, h: 10 }, 200);
    paint(m, h, 'b', { x: 20, y: 20, w: 10, h: 10 }, 100);
    h.undo(m);
    expect(h.canRedo).toBe(true);
    paint(m, h, 'c', { x: 40, y: 40, w: 10, h: 10 }, 50);
    expect(h.canRedo).toBe(false);
    expect(m.get(25, 25)).toBe(0);
    expect(m.get(45, 45)).toBe(50);
  });

  it('stores only touched tiles, compressed: a small edit in a 12 MP mask is a few KB', () => {
    const m = new TiledMask(4000, 3000);
    const h = new MaskHistory();
    const changed = paint(m, h, 'dab', { x: 2100, y: 1600, w: 60, h: 60 }, 255);
    expect(changed).toHaveLength(1);
    expect(h.bytes).toBeLessThan(4096);
  });

  it('an edit that changes nothing records nothing; rollback restores the tiles', () => {
    const m = new TiledMask(600, 600);
    const h = new MaskHistory();
    expect(paint(m, h, 'noop', { x: 0, y: 0, w: 10, h: 10 }, 0)).toEqual([]);
    expect(h.canUndo).toBe(false);
    const s = h.begin(m, 'x');
    s.touch(0);
    m.writeRegion({ x: 0, y: 0, w: 5, h: 5 }, new Uint8Array(25).fill(9));
    s.rollback();
    expect(m.get(1, 1)).toBe(0);
  });
});

describe('EditState', () => {
  it('round-trips and falls back to defaults on junk', () => {
    const s = parseEditState(serializeEditState(DEFAULT_EDIT_STATE));
    expect(s).toEqual(DEFAULT_EDIT_STATE);
    expect(parseEditState('not json')).toEqual(DEFAULT_EDIT_STATE);
    expect(parseEditState(null)).toEqual(DEFAULT_EDIT_STATE);
    const odd = parseEditState(
      JSON.stringify({
        transform: { rotation: 999, scale: 'x' },
        shadow: { kind: 'zzz', opacity: 5 },
        background: { kind: 'color', color: 'red' },
      }),
    );
    expect(odd.transform.rotation).toBe(180);
    expect(odd.transform.scale).toBe(1);
    expect(odd.shadow.kind).toBe('none');
    expect(odd.shadow.opacity).toBe(1);
    expect(odd.background).toEqual({ kind: 'color', color: '#FFFFFF' });
  });
});
