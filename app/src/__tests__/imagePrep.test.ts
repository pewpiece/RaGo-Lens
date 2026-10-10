import {
  MAX_PHOTO_PIXELS,
  cappedSize,
  capScale,
  prepareWorkingImage,
  preparePhoto,
  type PrepDeps,
} from '@/engine/imagePrep';

describe('capScale / cappedSize', () => {
  it('never upscales', () => {
    expect(capScale(800, 600, 2048)).toBe(1);
    expect(cappedSize(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });
  it('fits a 12 MP photo to the cap, keeping aspect ratio', () => {
    expect(cappedSize(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(cappedSize(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
  });
});

describe('prepareWorkingImage', () => {
  const mk = (size: { width: number; height: number } | Error) => {
    const calls: unknown[] = [];
    const deps: PrepDeps = {
      getSize: async () => {
        if (size instanceof Error) throw size;
        return size;
      },
      manipulate: async (uri, resize) => {
        calls.push(resize);
        const w = resize && 'width' in resize ? resize.width : 4000;
        return { uri: `${uri}.prep`, width: w, height: 1500 };
      },
    };
    return { deps, calls };
  };

  it('resizes by width for big landscape photos', async () => {
    const { deps, calls } = mk({ width: 4000, height: 3000 });
    await prepareWorkingImage('file:///a.jpg', 2048, deps);
    expect(calls).toEqual([{ width: 2048 }]);
  });
  it('resizes by height for big portrait photos', async () => {
    const { deps, calls } = mk({ width: 3000, height: 4000 });
    await prepareWorkingImage('file:///a.jpg', 2048, deps);
    expect(calls).toEqual([{ height: 2048 }]);
  });
  it('only normalises orientation for small photos', async () => {
    const { deps, calls } = mk({ width: 1000, height: 800 });
    await prepareWorkingImage('file:///a.jpg', 2048, deps);
    expect(calls).toEqual([null]);
  });
  it('falls back to normalise-then-shrink when the size is unknown', async () => {
    const { deps, calls } = mk(new Error('no size'));
    const r = await prepareWorkingImage('file:///a.jpg', 2048, deps);
    expect(calls).toEqual([null, { width: 2048 }]);
    expect(r.uri.endsWith('.prep.prep')).toBe(true);
  });
});

describe('preparePhoto (full-resolution original + working copy)', () => {
  const mk = (size: { width: number; height: number } | Error) => {
    const calls: unknown[] = [];
    const deps: PrepDeps = {
      getSize: async () => {
        if (size instanceof Error) throw size;
        return size;
      },
      manipulate: async (uri, resize) => {
        calls.push(resize);
        // pretend the manipulator honours the requested width/height
        const base = size instanceof Error ? { width: 5000, height: 4000 } : size;
        let w = base.width;
        let h = base.height;
        if (resize && 'width' in resize) {
          h = Math.round((h * resize.width) / w);
          w = resize.width;
        } else if (resize && 'height' in resize) {
          w = Math.round((w * resize.height) / h);
          h = resize.height;
        }
        return { uri: `${uri}.m${calls.length}`, width: w, height: h };
      },
    };
    return { deps, calls };
  };

  it('keeps the photo at full resolution and only makes a smaller working copy for the model', async () => {
    const { deps, calls } = mk({ width: 4000, height: 3000 });
    const p = await preparePhoto('file:///a.jpg', 2048, deps);
    expect([p.original.width, p.original.height]).toEqual([4000, 3000]);
    expect([p.working.width, p.working.height]).toEqual([2048, 1536]);
    expect(p.scaledDownFrom).toBeUndefined();
    expect(calls).toEqual([null, { width: 2048 }]);
    expect(p.working.uri).not.toBe(p.original.uri);
  });

  it('a photo already within the cap is its own working copy (no second file)', async () => {
    const { deps, calls } = mk({ width: 1600, height: 1200 });
    const p = await preparePhoto('file:///a.jpg', 2048, deps);
    expect(p.working).toBe(p.original);
    expect(calls).toEqual([null]);
  });

  it('above 24 MP the photo is scaled down to fit, never silently: the original size is reported', async () => {
    const { deps } = mk({ width: 7000, height: 5000 }); // 35 MP
    const p = await preparePhoto('file:///big.jpg', 2048, deps);
    expect(p.scaledDownFrom).toEqual({ width: 7000, height: 5000 });
    expect(p.original.width * p.original.height).toBeLessThanOrEqual(MAX_PHOTO_PIXELS);
    expect(p.original.width * p.original.height).toBeGreaterThan(MAX_PHOTO_PIXELS * 0.97);
    // exactly 24 MP is accepted untouched
    const ok = await preparePhoto('file:///ok.jpg', 2048, mk({ width: 6000, height: 4000 }).deps);
    expect(ok.scaledDownFrom).toBeUndefined();
    expect([ok.original.width, ok.original.height]).toEqual([6000, 4000]);
  });

  it('when the size cannot be read up front it normalises first and still enforces the limit', async () => {
    const { deps } = mk(new Error('no size'));
    const p = await preparePhoto('file:///x.jpg', 2048, deps); // manipulate() answers 5000x4000 = 20 MP
    expect([p.original.width, p.original.height]).toEqual([5000, 4000]);
    const tight = await preparePhoto('file:///x.jpg', 2048, deps, 10_000_000);
    expect(tight.scaledDownFrom).toEqual({ width: 5000, height: 4000 });
    expect(tight.original.width * tight.original.height).toBeLessThanOrEqual(10_000_000);
  });
});
