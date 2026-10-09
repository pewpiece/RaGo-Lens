import { cappedSize, capScale, prepareWorkingImage, type PrepDeps } from '@/engine/imagePrep';

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
