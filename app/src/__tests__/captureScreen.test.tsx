import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Capture from '@/app/capture';
import { useSession } from '@/store/session';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
let mockAssess: (uri: string) => Promise<{ tips: string[] } | null> = async () => ({ tips: [] });
const mockCameraProps: { autofocus?: string }[] = [];
const accelListeners: ((d: { x: number; y: number; z: number }) => void)[] = [];
const lightListeners: ((d: { illuminance: number }) => void)[] = [];

jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: React.forwardRef((props: { autofocus?: string }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: async () => ({ uri: 'file:///shot.jpg' }),
      }));
      mockCameraProps.push({ autofocus: props.autofocus });
      return <View testID="camera" />;
    }),
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});
jest.mock('expo-sensors', () => ({
  Accelerometer: {
    isAvailableAsync: async () => true,
    setUpdateInterval: jest.fn(),
    addListener: (fn: (d: { x: number; y: number; z: number }) => void) => {
      accelListeners.push(fn);
      return { remove: () => accelListeners.splice(accelListeners.indexOf(fn), 1) };
    },
  },
  LightSensor: {
    isAvailableAsync: async () => true,
    setUpdateInterval: jest.fn(),
    addListener: (fn: (d: { illuminance: number }) => void) => {
      lightListeners.push(fn);
      return { remove: () => lightListeners.splice(lightListeners.indexOf(fn), 1) };
    },
  },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Medium: 'm' },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock('@/capture/assess', () => ({ assessUri: (u: string) => mockAssess(u) }));
jest.mock('@/store/instances', () => {
  const { memoryKv } = jest.requireActual('@/db/kv');
  const { createSettingsStore } = jest.requireActual('@/store/settingsStore');
  const { createThemeStore } = jest.requireActual('@/store/themeStore');
  const kv = memoryKv();
  return { useThemeStore: createThemeStore(kv), useSettingsStore: createSettingsStore(kv) };
});

const wrap = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;
const emit = async (fn: () => void) => {
  await act(async () => fn());
};

beforeEach(async () => {
  mockPush.mockClear();
  mockParams = {};
  mockAssess = async () => ({ tips: [] });
  mockCameraProps.length = 0;
  accelListeners.length = 0;
  lightListeners.length = 0;
  useSession.getState().clear();
  await render(wrap(<Capture />));
  await waitFor(() => expect(accelListeners.length).toBe(1));
});

describe('Capture guidance', () => {
  it('shows a grid and a level indicator that turns green when the phone is straight', async () => {
    expect(screen.getByTestId('capture-grid')).toBeTruthy();
    await emit(() => accelListeners[0]!({ x: Math.sin(0.2), y: Math.cos(0.2), z: 0 })); // ~11.5 degrees
    expect(screen.getByLabelText(/Level indicator: \+11\.5°, not level/)).toBeTruthy();
    await emit(() => accelListeners[0]!({ x: 0, y: 1, z: 0 }));
    expect(screen.getByLabelText(/Level indicator: 0\.0°, level/)).toBeTruthy();
    await emit(() => accelListeners[0]!({ x: 0.05, y: 0, z: 0.99 })); // flat on a table, nearly level
    expect(screen.getByLabelText(/Level indicator: Tilt \d\.\d°/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide grid' }));
    expect(screen.queryByTestId('capture-grid')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Hide level' }));
    expect(screen.queryByTestId('capture-level')).toBeNull();
  });

  it('warns about low light and about an unsteady hand', async () => {
    expect(screen.queryByTestId('warn-lowlight')).toBeNull();
    await emit(() => lightListeners[0]!({ illuminance: 12 }));
    expect(screen.getByTestId('warn-lowlight')).toBeTruthy();
    await emit(() => lightListeners[0]!({ illuminance: 300 }));
    expect(screen.queryByTestId('warn-lowlight')).toBeNull();
    await emit(() => {
      for (let i = 0; i < 8; i++) accelListeners[0]!({ x: 0, y: 1 + (i % 2 ? 0.3 : -0.3), z: 0.2 });
    });
    expect(screen.getByTestId('warn-shaky')).toBeTruthy();
  });

  it('tap to focus shows a ring and asks the camera to refocus, then settles', async () => {
    jest.useFakeTimers();
    await fireEvent(screen.getByTestId('focus-surface'), 'press', {
      nativeEvent: { locationX: 120, locationY: 200 },
    });
    expect(screen.getByTestId('focus-ring')).toBeTruthy();
    expect(mockCameraProps.some((p) => p.autofocus === 'on')).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('focus-ring')).toBeNull();
    expect(mockCameraProps[mockCameraProps.length - 1]!.autofocus).toBe('off');
    jest.useRealTimers();
  });

  it('a clean photo goes straight on; a blurry or dark-product photo shows tips with Retake / Use photo', async () => {
    await fireEvent.press(screen.getByTestId('shutter'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/processing'));
    expect(screen.queryByTestId('capture-review')).toBeNull();
    mockPush.mockClear();
    mockAssess = async () => ({
      tips: [
        'The photo looks blurry. Hold the phone steady, tap to focus, and retake it.',
        'Dark product? Place it on a light surface.',
      ],
    });
    await fireEvent.press(screen.getByTestId('shutter'));
    expect(await screen.findByTestId('capture-review')).toBeTruthy();
    expect(screen.getByText(/Dark product\? Place it on a light surface\./)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('review-retake'));
    expect(screen.queryByTestId('capture-review')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('shutter'));
    await fireEvent.press(await screen.findByTestId('review-use'));
    expect(mockPush).toHaveBeenCalledWith('/processing');
    expect(useSession.getState().sourceUri).toBe('file:///shot.jpg');
  });
});
