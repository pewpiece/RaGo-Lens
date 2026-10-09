import { enabledModes, getMode, MODES } from '@/modes/registry';

describe('modes registry', () => {
  it('has Cutout enabled with a route and engine', () => {
    const c = getMode('cutout')!;
    expect(c.enabled).toBe(true);
    expect(c.route).toBe('/capture');
    expect(c.engine).toBe('segmentation');
  });
  it('keeps Scan as a disabled placeholder with no route or engine', () => {
    const s = getMode('scan')!;
    expect(s).toMatchObject({ enabled: false, route: null, engine: null, accent: 'accentScan' });
  });
  it('only Cutout is enabled and ids are unique', () => {
    expect(enabledModes().map((m) => m.id)).toEqual(['cutout']);
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length);
  });
  it('returns undefined for unknown modes', () => {
    expect(getMode('nope')).toBeUndefined();
  });
});
