import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Home from '@/app/index';
import Settings from '@/app/settings';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { useSettingsStore, useThemeStore } from '@/store/instances';
import { clearLibrary } from '@/library/library';
import { Alert } from 'react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockItems: unknown[] = [];

jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useFocusEffect: jest.fn(),
}));
jest.mock('@/store/instances', () => {
  const { memoryKv: mk } = jest.requireActual('@/db/kv');
  const { createSettingsStore: cs } = jest.requireActual('@/store/settingsStore');
  const { createThemeStore: ct } = jest.requireActual('@/store/themeStore');
  const kv = mk();
  return { useThemeStore: ct(kv), useSettingsStore: cs(kv) };
});
jest.mock('@/library/useLibrary', () => ({
  useLibraryItems: () => ({ items: mockItems, error: null, loaded: true, refresh: jest.fn() }),
}));
jest.mock('@/library/openAction', () => ({ openLibraryItem: jest.fn() }));
jest.mock('@/library/library', () => ({ clearLibrary: jest.fn() }));

const wrap = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockItems = [];
});

describe('Home', () => {
  it('shows Cutout as active and Scan as coming soon', async () => {
    await render(wrap(<Home />));
    expect(screen.getByText('Cutout')).toBeTruthy();
    expect(screen.getAllByText('Coming soon').length).toBeGreaterThan(0);
    expect(screen.getByTestId('mode-scan').props.accessibilityState.disabled).toBe(true);
  });

  it('opens the capture screen from the Cutout card, but not from Scan', async () => {
    await render(wrap(<Home />));
    await fireEvent.press(screen.getByTestId('mode-cutout'));
    expect(mockPush).toHaveBeenCalledWith('/capture');
    mockPush.mockClear();
    await fireEvent.press(screen.getByTestId('mode-scan'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows an empty state with no recent results', async () => {
    await render(wrap(<Home />));
    expect(screen.getByText(/cut-outs will show up here/i)).toBeTruthy();
    expect(screen.queryByText('See all')).toBeNull();
  });

  it('shows recent results and a link to the library', async () => {
    mockItems = [{ id: 'a', thumbUri: 'file:///t.png', createdAt: 1_700_000_000_000 }];
    await render(wrap(<Home />));
    expect(screen.getByText('See all')).toBeTruthy();
    expect(screen.getByLabelText(/Open result from/)).toBeTruthy();
  });

  it('opens settings', async () => {
    await render(wrap(<Home />));
    await fireEvent.press(screen.getByLabelText('Settings'));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
});

describe('Settings', () => {
  it('switches theme live via the segmented control', async () => {
    await render(wrap(<Settings />));
    expect(useThemeStore.getState().mode).toBe('system');
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    expect(useThemeStore.getState().mode).toBe('dark');
    await fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
    expect(useThemeStore.getState().mode).toBe('light');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Light' }).props.accessibilityState.selected).toBe(
        true,
      ),
    );
  });

  it('changes export defaults and working size', async () => {
    await render(wrap(<Settings />));
    await fireEvent.press(screen.getByRole('radio', { name: 'White' }));
    expect(useSettingsStore.getState().exportDefaults.background).toBe('white');
    await fireEvent.press(screen.getByRole('radio', { name: '1536' }));
    expect(useSettingsStore.getState().workingSizeCap).toBe(1536);
  });

  it('toggles the developer mock engine', async () => {
    await render(wrap(<Settings />));
    await fireEvent.press(screen.getByRole('switch', { name: 'Developer: use mock engine' }));
    expect(useSettingsStore.getState().useMockEngine).toBe(true);
  });

  it('asks for confirmation before clearing the library', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await render(wrap(<Settings />));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear library' }));
    expect(alert).toHaveBeenCalled();
    expect(clearLibrary).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Library cleared.')).toBeTruthy());
    alert.mockRestore();
  });

  it('shows the model licence in About', async () => {
    await render(wrap(<Settings />));
    expect(screen.getByText(/Apache License 2.0/)).toBeTruthy();
  });
});
