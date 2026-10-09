import { enabledModes, getMode, MODES } from '@/modes/registry';

describe('modes registry', () => {
  it('has Cutout enabled with a route and engine', () => {
    const c = getMode('cutout')!;
    expect(c.enabled).toBe(true);
    expect(c.route).toBe('/capture');
    expect(c.engine).toBe('segmentation');
  });
  it('has Scan enabled with its own route, OCR engine and teal accent', () => {
    const s = getMode('scan')!;
    expect(s).toMatchObject({
      enabled: true,
      route: '/capture?mode=scan',
      engine: 'ocr',
      accent: 'accentScan',
    });
  });
  it('both modes are enabled and ids are unique', () => {
    expect(enabledModes().map((m) => m.id)).toEqual(['cutout', 'scan']);
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length);
  });
  it('returns undefined for unknown modes', () => {
    expect(getMode('nope')).toBeUndefined();
  });
});
