import { Appearance } from 'react-native';
import { memoryKv } from '@/db/kv';
import { DEFAULT_EXPORT_OPTIONS, parseExportOptions } from '@/export/options';
import { clampWorkingSize, createSettingsStore } from '@/store/settingsStore';
import { createThemeStore, THEME_KEY } from '@/store/themeStore';

describe('theme store', () => {
  it('defaults to system before hydration', () => {
    expect(createThemeStore(memoryKv()).getState().mode).toBe('system');
  });

  it('hydrates a persisted choice', async () => {
    const store = createThemeStore(memoryKv({ [THEME_KEY]: 'light' }));
    await store.getState().hydrate();
    expect(store.getState().mode).toBe('light');
    expect(store.getState().hydrated).toBe(true);
  });

  it('ignores garbage in storage', async () => {
    const store = createThemeStore(memoryKv({ [THEME_KEY]: 'neon' }));
    await store.getState().hydrate();
    expect(store.getState().mode).toBe('system');
  });

  it('applies changes live, persists them and informs the OS appearance', async () => {
    const kv = memoryKv();
    const spy = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
    const store = createThemeStore(kv);
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.mode));
    const p = store.getState().setMode('dark');
    expect(store.getState().mode).toBe('dark'); // synchronous: no restart/await needed
    await p;
    expect(await kv.get(THEME_KEY)).toBe('dark');
    expect(spy).toHaveBeenLastCalledWith('dark');
    await store.getState().setMode('system');
    expect(spy).toHaveBeenLastCalledWith('unspecified');
    expect(seen).toEqual(['dark', 'system']);
    spy.mockRestore();
  });

  it('survives a failing storage backend', async () => {
    const kv = memoryKv();
    kv.set = async () => {
      throw new Error('disk full');
    };
    const store = createThemeStore(kv);
    await expect(store.getState().setMode('light')).resolves.toBeUndefined();
    expect(store.getState().mode).toBe('light');
  });
});

describe('settings store', () => {
  it('has sane defaults', () => {
    const s = createSettingsStore(memoryKv()).getState();
    expect(s.workingSizeCap).toBe(2048);
    expect(s.useMockEngine).toBe(false);
    expect(s.exportDefaults).toEqual(DEFAULT_EXPORT_OPTIONS);
  });

  it('persists and re-hydrates every setting', async () => {
    const kv = memoryKv();
    const a = createSettingsStore(kv);
    await a.getState().setExportDefaults({ background: 'white', size: 1024 });
    await a.getState().setWorkingSizeCap(1536);
    await a.getState().setUseMockEngine(true);
    const b = createSettingsStore(kv);
    await b.getState().hydrate();
    expect(b.getState().exportDefaults).toMatchObject({
      background: 'white',
      size: 1024,
      autoCrop: true,
    });
    expect(b.getState().workingSizeCap).toBe(1536);
    expect(b.getState().useMockEngine).toBe(true);
  });

  it('clamps the working size', () => {
    expect(clampWorkingSize(10)).toBe(512);
    expect(clampWorkingSize(99999)).toBe(4096);
    expect(clampWorkingSize(NaN)).toBe(2048);
  });
});

describe('parseExportOptions', () => {
  it('falls back to defaults for invalid JSON and bad fields', () => {
    expect(parseExportOptions('nope')).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(parseExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(
      parseExportOptions(JSON.stringify({ background: 'plaid', size: 5, color: 'red' })),
    ).toEqual(DEFAULT_EXPORT_OPTIONS);
  });
});
