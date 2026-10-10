/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 *
 * The compose / export screen with real Skia rendering behind it (only the on-screen Canvas and native modules are stubbed).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PanResponder } from 'react-native';
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import ExportScreen from '@/app/export';
import { pngColorType } from '@/export/png';
import { clearOpenDocs } from '@/editor/registry';
import { maskToImage } from '@/mask/maskImage';
import { TiledMask } from '@/mask/tiledMask';
import { useSession } from '@/store/session';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { objectWithBlob } from '../../test/fixtures';
import initSqlJs from 'sql.js';

const mockDisk = new Map<string, Uint8Array>();
const mockSaved: string[] = [];
const mockEditStates: string[] = [];
let mockPresetRows: {
  id: string;
  name: string;
  json: string;
  builtin: number;
  position: number;
  createdAt: number;
  updatedAt: number;
}[] = [];

jest.mock('@shopify/react-native-skia', () => ({
  ...require('@/testing/skiaReal').skiaReal(),
  Canvas: () => null,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
}));
jest.mock('@/store/instances', () => {
  const { memoryKv } = jest.requireActual('@/db/kv');
  const { createSettingsStore } = jest.requireActual('@/store/settingsStore');
  const { createThemeStore } = jest.requireActual('@/store/themeStore');
  const kv = memoryKv();
  return { useThemeStore: createThemeStore(kv), useSettingsStore: createSettingsStore(kv) };
});
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 's' },
}));
jest.mock('@/lib/files', () => ({
  writeCacheFile: (name: string, bytes: Uint8Array) => {
    mockDisk.set(`file:///cache/${name}`, bytes.slice());
    return `file:///cache/${name}`;
  },
  readFileHead: (uri: string, n: number) => mockDisk.get(uri)!.slice(0, n),
  tempName: (p: string, e: string) => `${p}-t.${e}`,
}));
jest.mock('expo-file-system', () => ({ Paths: { availableDiskSpace: 1e12 } }));
jest.mock('expo-media-library/legacy', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  saveToLibraryAsync: jest.fn(async (uri: string) => {
    mockSaved.push(uri);
  }),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock('expo-clipboard', () => ({ setImageAsync: jest.fn(async () => {}) }));
jest.mock('@/library/library', () => ({
  assertStorage: () => {},
  getItem: () => undefined,
  saveEditState: (_id: string, json: string) => mockEditStates.push(json),
  maskUriOf: () => null,
}));
jest.mock('@/db/client', () => ({ getDb: () => (globalThis as { __testDb?: unknown }).__testDb }));

jest.spyOn(PanResponder, 'create').mockImplementation(
  (cfg) =>
    ({
      panHandlers: {
        onResponderGrant: (e: unknown) => cfg.onPanResponderGrant?.(e as never, {} as never),
        onResponderMove: (e: unknown) => cfg.onPanResponderMove?.(e as never, {} as never),
        onResponderRelease: (e: unknown) => cfg.onPanResponderRelease?.(e as never, {} as never),
      },
    }) as never,
);

const f = objectWithBlob(600, 400);
const photo = (): SkImage =>
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
const touch = (x: number, y: number) => ({
  nativeEvent: { touches: [{ locationX: x, locationY: y }] },
});

beforeAll(async () => {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  const { drizzle } = require('drizzle-orm/sql-js');
  const schema = require('@/db/schema');
  const { MIGRATIONS, runMigrations } = require('@/db/migrations');
  runMigrations(
    {
      execSync: (sql: string) => raw.run(sql),
      getFirstSync: (sql: string) => {
        const r = raw.exec(sql)[0];
        if (!r) return null;
        const o: Record<string, unknown> = {};
        r.columns.forEach((c: string, i: number) => (o[c] = r.values[0]![i]));
        return o;
      },
    },
    MIGRATIONS,
  );
  (globalThis as { __testDb?: unknown }).__testDb = drizzle(raw, { schema });
  void mockPresetRows;
});

beforeEach(async () => {
  clearOpenDocs();
  mockDisk.clear();
  mockSaved.length = 0;
  mockEditStates.length = 0;
  useSession.setState({
    sourceUri: 'file:///photo.jpg',
    capOverride: null,
    itemId: 'row1',
    notice: null,
    result: {
      sourceUri: 'file:///photo.jpg',
      workingUri: 'file:///photo.jpg',
      width: f.width,
      height: f.height,
      original: photo(),
      maskLayer: maskToImage(TiledMask.fromFlat(f.truth, f.width, f.height)),
      maskUri: 'file:///m.png',
      engineId: 'fake',
      foundObject: true,
    },
  });
  await render(
    <ThemeProvider>
      <ExportScreen />
    </ThemeProvider>,
  );
  await waitFor(
    () =>
      expect(
        screen.getByRole('button', { name: 'Save to gallery' }).props.accessibilityState.disabled,
      ).toBe(false),
    { timeout: 8000 },
  );
  await fireEvent(screen.getByTestId('compose-stage'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 320 } },
  });
});

describe('Compose and export screen', () => {
  it("saves a transparent PNG at the product's own resolution, verified from the file that was written", async () => {
    await fireEvent.press(screen.getByRole('button', { name: 'Save to gallery' }));
    await waitFor(() => expect(mockSaved).toHaveLength(1), { timeout: 8000 });
    const bytes = mockDisk.get(mockSaved[0]!)!;
    expect(mockSaved[0]).toMatch(/\.png$/);
    expect(pngColorType(bytes)).toBe(6);
    expect(
      await screen.findByText(/Saved to your gallery \(\d+×\d+ PNG, transparent\)/),
    ).toBeTruthy();
    // the oval product is 312x240 px; plus 4 % of the longer side on every side = 337x265
    expect(screen.getByText(/33\d × 26\d px · PNG with transparency/)).toBeTruthy();
  });

  it('a preset switches the canvas, background, file type and shows white-on-square JPEG', async () => {
    await fireEvent.press(screen.getByTestId('tab-preset'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Square, pure white 2000x2000' }));
    await waitFor(() => expect(screen.getByText(/2000 × 2000 px · JPEG/)).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Save to gallery' }));
    await waitFor(() => expect(mockSaved).toHaveLength(1), { timeout: 20000 });
    expect(mockSaved[0]).toMatch(/\.jpg$/);
    const head = mockDisk.get(mockSaved[0]!)!;
    expect(head[0]).toBe(0xff);
    expect(head[1]).toBe(0xd8);
  }, 40000);

  it('rotate and flip buttons change the picture settings, which are remembered with the item', async () => {
    await fireEvent.press(screen.getByTestId('tab-move'));
    await fireEvent.press(screen.getByTestId('rot-right'));
    await fireEvent.press(screen.getByTestId('flip-h'));
    await waitFor(() => expect(mockEditStates.length).toBeGreaterThan(0), { timeout: 4000 });
    const last = JSON.parse(mockEditStates[mockEditStates.length - 1]!);
    expect(last.transform.rotation).toBe(90);
    expect(last.transform.flipH).toBe(true);
    // 90 degrees swaps the output shape (wider than tall -> taller than wide)
    expect(screen.getByText(/26\d × 33\d px/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('reset-transform'));
    await waitFor(() => expect(screen.getByText(/33\d × 26\d px/)).toBeTruthy());
  });

  it('dragging the preview moves the product (and is saved)', async () => {
    await fireEvent.press(screen.getByTestId('tab-move'));
    await fireEvent(screen.getByTestId('compose-touch'), 'responderGrant', touch(100, 100));
    await fireEvent(screen.getByTestId('compose-touch'), 'responderMove', touch(130, 110));
    await fireEvent(screen.getByTestId('compose-touch'), 'responderRelease', touch(130, 110));
    await waitFor(() => expect(mockEditStates.length).toBeGreaterThan(0), { timeout: 4000 });
    const last = JSON.parse(mockEditStates[mockEditStates.length - 1]!);
    expect(last.transform.cx).toBeGreaterThan(0.5);
    expect(last.transform.cy).toBeGreaterThan(0.5);
  });

  it('the Check tab runs the readiness checks and offers fixes', async () => {
    await fireEvent.press(screen.getByTestId('tab-preset'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Portrait 4:5 on white' }));
    await fireEvent.press(screen.getByTestId('tab-check'));
    await waitFor(() => expect(screen.getByTestId('check-fill')).toBeTruthy(), { timeout: 20000 });
    for (const id of [
      'background',
      'fill',
      'centre',
      'resolution',
      'sharpness',
      'exposure',
      'leftovers',
      'holes',
      'transparency',
    ])
      if (id !== 'sharpness') expect(screen.getByTestId(`check-${id}`)).toBeTruthy();
    // the 600 px photo is enlarged a lot to fill a 1600x2000 portrait canvas: the checker says so
    expect(screen.getByTestId('check-resolution')).toHaveTextContent(/enlarged/);
  }, 40000);

  it('an export failure is explained, not swallowed', async () => {
    const lib = jest.requireMock('expo-media-library/legacy');
    lib.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Save to gallery' }));
    expect(
      await screen.findByText(/needs permission to save/i, undefined, { timeout: 8000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    void act;
  });
});
