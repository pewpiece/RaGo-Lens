import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import Capture from '@/app/capture';
import ExportScreen from '@/app/export';
import Library from '@/app/library';
import Processing from '@/app/processing';
import Result from '@/app/result';
import { ExportError, saveToGallery } from '@/export/actions';
import { runCutout } from '@/engine/pipeline';
import { CutoutError } from '@/engine/types';
import { deleteItems } from '@/library/library';
import { useSession } from '@/store/session';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockItems: unknown[] = [];
let mockCameraPermission: { granted: boolean; canAskAgain: boolean } | null = null;
const mockRequestPermission = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    back: () => mockBack(),
    canGoBack: () => true,
  },
  useFocusEffect: jest.fn(),
}));
jest.mock('@/store/instances', () => {
  const { memoryKv } = jest.requireActual('@/db/kv');
  const { createSettingsStore } = jest.requireActual('@/store/settingsStore');
  const { createThemeStore } = jest.requireActual('@/store/themeStore');
  const kv = memoryKv();
  return { useThemeStore: createThemeStore(kv), useSettingsStore: createSettingsStore(kv) };
});
jest.mock('@/engine/factory', () => ({
  getEngine: () => ({ id: 'fake' }),
  devicePipelineDeps: {},
}));
jest.mock('@/engine/pipeline', () => ({ runCutout: jest.fn() }));
jest.mock('@/library/saveResult', () => ({
  saveResultToLibrary: jest.fn(async () => ({ id: 'row1' })),
  updateLibraryItem: jest.fn(),
}));
jest.mock('@/library/library', () => ({ deleteItems: jest.fn(), clearLibrary: jest.fn() }));
jest.mock('@/library/useLibrary', () => ({
  useLibraryItems: () => ({ items: mockItems, error: null, loaded: true, refresh: jest.fn() }),
}));
jest.mock('@/library/openAction', () => ({ openLibraryItem: jest.fn() }));
jest.mock('@/components/SceneCanvas', () => ({ SceneCanvas: () => null }));
jest.mock('@shopify/react-native-skia', () => ({
  Canvas: () => null,
  Group: () => null,
  Skia: {},
  ImageFormat: { PNG: 4 },
}));
jest.mock('@/scene/exportRender', () => ({
  ExportTree: () => null,
  objectBoundsOf: jest.fn(async () => ({ left: 0, top: 0, right: 10, bottom: 10 })),
  renderExport: jest.fn(async () => ({
    image: { encodeToBase64: () => 'x' },
    png: new Uint8Array(4),
    width: 10,
    height: 10,
    expectsAlpha: true,
  })),
}));
jest.mock('@/export/actions', () => {
  class ExportError extends Error {
    kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
    }
  }
  return {
    ExportError,
    saveToGallery: jest.fn(),
    shareFile: jest.fn(),
    copyImage: jest.fn(),
    writeVerifiedPng: jest.fn(() => 'file:///cache/x.png'),
  };
});
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [mockCameraPermission, mockRequestPermission],
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Medium: 'm' },
  NotificationFeedbackType: { Success: 's', Warning: 'w' },
}));

const wrap = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;
const fakeResult = (over = {}) => ({
  sourceUri: 'file:///p.jpg',
  workingUri: 'file:///w.jpg',
  width: 100,
  height: 80,
  original: {},
  maskLayer: {},
  maskUri: 'file:///m.png',
  engineId: 'fake',
  foundObject: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (runCutout as jest.Mock).mockReset(); // drop any queued one-shot results from earlier tests
  mockItems = [];
  mockCameraPermission = null;
  useSession.getState().clear();
});

describe('Processing', () => {
  it('runs the pipeline, saves to the library and opens the result', async () => {
    (runCutout as jest.Mock).mockResolvedValueOnce(fakeResult());
    useSession.getState().setSource('file:///p.jpg');
    await render(wrap(<Processing />));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/result'));
    expect(useSession.getState().result?.width).toBe(100);
    expect(useSession.getState().itemId).toBe('row1');
    expect((runCutout as jest.Mock).mock.calls[0][0]).toMatchObject({
      uri: 'file:///p.jpg',
      cap: 2048,
    });
  });

  it('shows a clear error and retries on request', async () => {
    (runCutout as jest.Mock)
      .mockRejectedValueOnce(
        new CutoutError(
          'out-of-memory',
          'The phone ran out of memory. Try a smaller working size in Settings.',
        ),
      )
      .mockResolvedValueOnce(fakeResult());
    useSession.getState().setSource('file:///p.jpg');
    await render(wrap(<Processing />));
    expect(await screen.findByText(/ran out of memory/i)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalledWith('/result');
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/result'));
    expect(runCutout).toHaveBeenCalledTimes(2);
  });

  it('never crashes on an unexpected (non-CutoutError) failure', async () => {
    (runCutout as jest.Mock).mockRejectedValueOnce(new Error('kaboom'));
    useSession.getState().setSource('file:///p.jpg');
    await render(wrap(<Processing />));
    expect(await screen.findByText(/something went wrong/i)).toBeTruthy();
  });

  it('keeps the result when the library save fails, and tells the user', async () => {
    const { saveResultToLibrary } = jest.requireMock('@/library/saveResult');
    saveResultToLibrary.mockRejectedValueOnce(
      new Error('Not enough free storage to save this result.'),
    );
    (runCutout as jest.Mock).mockResolvedValueOnce(fakeResult());
    useSession.getState().setSource('file:///p.jpg');
    await render(wrap(<Processing />));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/result'));
    expect(useSession.getState().result).not.toBeNull();
    expect(useSession.getState().itemId).toBeNull();
    expect(useSession.getState().notice).toMatch(/not saved to your library/i);
  });

  it('cancel aborts the run and goes back without opening a result', async () => {
    let signal: AbortSignal | undefined;
    (runCutout as jest.Mock).mockImplementationOnce(
      (opts: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = opts.signal;
          opts.signal.addEventListener('abort', () =>
            reject(new CutoutError('cancelled', 'Cancelled')),
          );
        }),
    );
    useSession.getState().setSource('file:///p.jpg');
    await render(wrap(<Processing />));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal?.aborted).toBe(true);
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith('/result');
  });

  it('uses the retry working-size override', async () => {
    (runCutout as jest.Mock).mockResolvedValueOnce(fakeResult());
    useSession.getState().setSource('file:///p.jpg', 1024);
    await render(wrap(<Processing />));
    await waitFor(() => expect(runCutout).toHaveBeenCalled());
    expect((runCutout as jest.Mock).mock.calls[0][0].cap).toBe(1024);
  });

  it('goes home when there is nothing to process', async () => {
    await render(wrap(<Processing />));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('Capture permissions', () => {
  it('offers to allow the camera and to pick from the gallery', async () => {
    mockCameraPermission = { granted: false, canAskAgain: true };
    await render(wrap(<Capture />));
    await fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(mockRequestPermission).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pick from gallery' })).toBeTruthy();
  });

  it('when permanently denied, points to phone settings and keeps the gallery path', async () => {
    mockCameraPermission = { granted: false, canAskAgain: false };
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(wrap(<Capture />));
    expect(screen.getByText(/denied/i)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open phone settings' }));
    expect(open).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Allow camera' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pick from gallery' })).toBeTruthy();
  });

  it('shows the camera controls when granted', async () => {
    mockCameraPermission = { granted: true, canAskAgain: true };
    await render(wrap(<Capture />));
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Flash off' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Flash off' }));
    expect(screen.getByRole('button', { name: 'Flash on' })).toBeTruthy();
  });
});

describe('Library', () => {
  const rows = [
    { id: 'a', thumbUri: 'file:///a.png', createdAt: 1_700_000_000_000 },
    { id: 'b', thumbUri: 'file:///b.png', createdAt: 1_700_100_000_000 },
  ];

  it('shows an empty state', async () => {
    await render(wrap(<Library />));
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });

  it('multi-select then delete asks for confirmation and deletes the chosen items', async () => {
    mockItems = rows;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await render(wrap(<Library />));
    await fireEvent(screen.getByTestId('item-a'), 'longPress');
    expect(screen.getByText('1 selected')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('item-b')); // tap adds while selecting
    expect(screen.getByText('2 selected')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(alert).toHaveBeenCalled();
    expect(deleteItems).toHaveBeenCalledWith(expect.arrayContaining(['a', 'b']));
    alert.mockRestore();
  });

  it('cancel clears the selection without deleting', async () => {
    mockItems = rows;
    await render(wrap(<Library />));
    await fireEvent(screen.getByTestId('item-a'), 'longPress');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Library')).toBeTruthy();
    expect(deleteItems).not.toHaveBeenCalled();
  });

  it('reports a failed delete instead of crashing', async () => {
    mockItems = rows;
    (deleteItems as jest.Mock).mockImplementationOnce(() => {
      throw new Error('disk');
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await render(wrap(<Library />));
    await fireEvent(screen.getByTestId('item-a'), 'longPress');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/could not delete/i)).toBeTruthy();
    alert.mockRestore();
  });
});

describe('Result', () => {
  it('goes home when there is no result', async () => {
    await render(wrap(<Result />));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('offers Refine, Retry and Export, and warns when nothing was found', async () => {
    useSession.setState({
      result: fakeResult({ foundObject: false }) as never,
      sourceUri: 'file:///p.jpg',
    });
    await render(wrap(<Result />));
    expect(screen.getByText(/No clear object was found/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Refine' }));
    expect(mockPush).toHaveBeenCalledWith('/refine');
    await fireEvent.press(screen.getByRole('button', { name: 'Export / Share' }));
    expect(mockPush).toHaveBeenCalledWith('/export');
  });

  it('shows the original while pressing and hiding it on release (before/after)', async () => {
    useSession.setState({ result: fakeResult() as never, sourceUri: 'file:///p.jpg' });
    await render(wrap(<Result />));
    expect(screen.queryByLabelText('Original photo')).toBeNull();
    await fireEvent(screen.getByTestId('compare'), 'pressIn');
    expect(screen.getByLabelText('Original photo')).toBeTruthy();
    await fireEvent(screen.getByTestId('compare'), 'pressOut');
    expect(screen.queryByLabelText('Original photo')).toBeNull();
  });

  it('retry with a different working size restarts processing', async () => {
    useSession.setState({ result: fakeResult() as never, sourceUri: 'file:///p.jpg' });
    await render(wrap(<Result />));
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await fireEvent.press(screen.getByRole('radio', { name: '1024' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Run again' }));
    expect(useSession.getState().capOverride).toBe(1024);
    expect(useSession.getState().result).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/processing');
  });

  it('surfaces a library-save notice', async () => {
    useSession.setState({
      result: fakeResult() as never,
      notice: 'Not saved to your library: low storage',
    });
    await render(wrap(<Result />));
    expect(screen.getByText(/low storage/)).toBeTruthy();
  });
});

describe('Export error handling', () => {
  const setup = async () => {
    useSession.setState({ result: fakeResult() as never });
    await render(wrap(<ExportScreen />));
    await act(async () => {});
  };

  it('explains a denied gallery permission and keeps Share available', async () => {
    (saveToGallery as jest.Mock).mockRejectedValueOnce(
      new ExportError('permission', 'RaGo Lens needs permission to save to your gallery.'),
    );
    await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Save to gallery' }));
    expect(await screen.findByText(/needs permission to save/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
  });

  it('confirms a successful save', async () => {
    await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Save to gallery' }));
    expect(await screen.findByText(/Saved to your gallery/)).toBeTruthy();
    expect(saveToGallery).toHaveBeenCalledWith('file:///cache/x.png');
  });

  it('turns an out-of-memory render into a friendly message', async () => {
    const { renderExport } = jest.requireMock('@/scene/exportRender');
    renderExport.mockRejectedValueOnce(new Error('Out of memory: could not render the export'));
    await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText(/Not enough memory/)).toBeTruthy();
  });

  it('switching to a coloured background shows colour choices', async () => {
    await setup();
    await fireEvent.press(screen.getByRole('radio', { name: 'Colour' }));
    expect(screen.getAllByRole('radio', { name: /^Colour #/ }).length).toBeGreaterThan(3);
  });
});
