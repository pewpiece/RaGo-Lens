/**
 * @jest-environment <rootDir>/node_modules/@shopify/react-native-skia/jestEnv.js
 *
 * The editor screen end to end with a real EditorDoc and real Skia pixel work; only the on-screen Canvas and the
 * native touch plumbing are stubbed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PanResponder } from 'react-native';
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import Editor from '@/app/editor';
import { getOpenDoc, clearOpenDocs, sessionKey } from '@/editor/registry';
import { maskToImage } from '@/mask/maskImage';
import { TiledMask } from '@/mask/tiledMask';
import { useSession } from '@/store/session';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { objectWithBlob } from '../../test/fixtures';

const mockBack = jest.fn();
const mockSaveDoc = jest.fn(async () => ({
  id: 'row1',
  maskUri: 'file:///m.png',
  settingsJson: '{}',
}));

jest.mock('@shopify/react-native-skia', () => ({
  ...require('@/testing/skiaReal').skiaReal(),
  Canvas: () => null,
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: () => mockBack(), canGoBack: () => true },
}));
jest.mock('@/store/instances', () => {
  const { memoryKv } = jest.requireActual('@/db/kv');
  const { createSettingsStore } = jest.requireActual('@/store/settingsStore');
  const { createThemeStore } = jest.requireActual('@/store/themeStore');
  const kv = memoryKv();
  return { useThemeStore: createThemeStore(kv), useSettingsStore: createSettingsStore(kv) };
});
jest.mock('@/editor/persist', () => ({ saveDoc: (...a: unknown[]) => mockSaveDoc(...(a as [])) }));
jest.mock('@/library/library', () => ({
  maskUriOf: (r: { maskUri?: string }) => r.maskUri ?? null,
}));

// touches without the native touch-history machinery
jest.spyOn(PanResponder, 'create').mockImplementation(
  (cfg) =>
    ({
      panHandlers: {
        onResponderGrant: (e: unknown) => cfg.onPanResponderGrant?.(e as never, {} as never),
        onResponderMove: (e: unknown) => cfg.onPanResponderMove?.(e as never, {} as never),
        onResponderRelease: (e: unknown) => cfg.onPanResponderRelease?.(e as never, {} as never),
        onResponderTerminate: (e: unknown) =>
          cfg.onPanResponderTerminate?.(e as never, {} as never),
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
const touches2 = (a: [number, number], b: [number, number]) => ({
  nativeEvent: {
    touches: [
      { locationX: a[0], locationY: a[1] },
      { locationX: b[0], locationY: b[1] },
    ],
  },
});

beforeEach(async () => {
  clearOpenDocs();
  mockBack.mockClear();
  mockSaveDoc.mockClear();
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
      maskLayer: maskToImage(TiledMask.fromFlat(f.modelMask, f.width, f.height)),
      maskUri: 'file:///m.png',
      engineId: 'fake',
      foundObject: true,
    },
  });
  await render(
    <ThemeProvider>
      <Editor />
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('tool-wand')).toBeTruthy(), { timeout: 5000 });
  // stage: 300 x 200 -> the 600x400 photo is shown at scale 0.5 with no offset
  await fireEvent(screen.getByTestId('editor-stage'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 200 } },
  });
});

const doc = () => getOpenDoc(sessionKey('row1', 'file:///photo.jpg'))!;
const surface = () => screen.getByTestId('editor-touch');

describe('Editor screen', () => {
  it('tap the logo with the tap-select tool, Remove it, then Undo', async () => {
    // photo (492, 200) is the logo; on screen that is (246, 100)
    await fireEvent(surface(), 'responderGrant', touch(246, 100));
    await fireEvent(surface(), 'responderRelease', touch(246, 100));
    await waitFor(() => expect(screen.getByTestId('sel-remove')).toBeTruthy(), { timeout: 5000 });
    expect(doc().hasSelection).toBe(true);
    expect(doc().mask.get(492, 200)).toBe(255); // selecting changes nothing yet
    await fireEvent.press(screen.getByTestId('sel-remove'));
    await waitFor(() => expect(doc().mask.get(492, 200)).toBe(0), { timeout: 5000 });
    expect(doc().mask.get(240, 200)).toBe(255); // the product is untouched
    expect(screen.queryByTestId('sel-remove')).toBeNull();
    await fireEvent.press(screen.getByTestId('undo'));
    await waitFor(() => expect(doc().mask.get(492, 200)).toBe(255));
  });

  it('the erase brush paints one undoable stroke; a second finger mid-stroke cancels it', async () => {
    await fireEvent.press(screen.getByTestId('tool-erase'));
    // a normal stroke across the product
    await fireEvent(surface(), 'responderGrant', touch(100, 100));
    await fireEvent(surface(), 'responderMove', touch(140, 100));
    await fireEvent(surface(), 'responderRelease', touch(140, 100));
    await waitFor(() => expect(doc().history.size).toBe(1), { timeout: 5000 });
    // the loupe is on by default: the brush is drawn 64 screen px ABOVE the finger, so the erased spot is
    // photo (240, 72+) and the product under the finger itself is untouched
    expect(doc().mask.get(240, 96)).toBe(0);
    expect(doc().mask.get(240, 200)).toBe(255);
    // a stroke interrupted by a second finger leaves no mark
    await fireEvent(surface(), 'responderGrant', touch(60, 150));
    await fireEvent(surface(), 'responderMove', touch(90, 150));
    await fireEvent(surface(), 'responderMove', touches2([90, 150], [200, 150]));
    await fireEvent(surface(), 'responderRelease', touch(90, 150));
    expect(doc().history.size).toBe(1);
  });

  it('Done saves the edits, updates the session and leaves; Cancel on an untouched doc just leaves', async () => {
    doc().commitStroke({
      mode: 'erase',
      size: 20,
      softness: 0,
      opacity: 1,
      points: [{ x: 240, y: 200 }],
    });
    await fireEvent.press(screen.getByTestId('done'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled(), { timeout: 5000 });
    expect(mockSaveDoc).toHaveBeenCalledTimes(1);
    expect(useSession.getState().result?.maskUri).toBe('file:///m.png');
  });

  it('lists clean-up suggestions on demand and never applies them by itself', async () => {
    const before = doc().mask.toFlat();
    await fireEvent.press(screen.getByTestId('suggestions-chip'));
    await waitFor(() => expect(screen.getAllByText(/Attached piece/).length).toBeGreaterThan(0), {
      timeout: 8000,
    });
    expect(Array.from(doc().mask.toFlat())).toEqual(Array.from(before));
    await act(async () => {
      await fireEvent.press(screen.getByLabelText(/Attached piece.*Tap to highlight/));
    });
    await fireEvent.press(screen.getByText('Remove'));
    await waitFor(() => expect(doc().mask.get(492, 200)).toBe(0), { timeout: 8000 });
  });

  it('view menu lists all view modes and remembers the choice', async () => {
    await fireEvent.press(screen.getByTestId('view-menu'));
    for (const label of [
      'Light checker',
      'Dark checker',
      'White',
      'Black',
      'Colour',
      'Removed in red',
      'Mask only',
      'Before / after',
    ])
      expect(screen.getByLabelText(label)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Removed in red'));
    const { useSettingsStore } = require('@/store/instances');
    await waitFor(() => expect(useSettingsStore.getState().editorViewMode).toBe('removed-red'));
  });
});
