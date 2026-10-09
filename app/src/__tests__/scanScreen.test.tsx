import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import ScanScreen from '@/app/scan';
import { markdownToPlain } from '@/scan/markdown';
import { MockOcrEngine } from '@/scan/mockOcr';
import { saveScanText, saveScanToLibrary } from '@/scan/saveScan';
import { useScanSession } from '@/store/scanSession';
import { useSettingsStore } from '@/store/instances';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockEngine: unknown;

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
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
jest.mock('@/scan/factory', () => ({
  getOcrEngine: () => mockEngine,
  deviceScanDeps: {
    prepare: async (uri: string) => ({ uri: `${uri}#work`, width: 3000, height: 2000 }),
  },
  deviceSaveDeps: { makeThumb: async () => 'file:///thumb.jpg' },
}));
jest.mock('@/scan/saveScan', () => ({
  saveScanToLibrary: jest.fn(async () => ({ id: 'row1' })),
  saveScanText: jest.fn(() => true),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 's' },
}));

const wrap = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine = new MockOcrEngine();
  useScanSession.getState().clear();
});

describe('Scan screen', () => {
  it('reads the page, shows the formatted text and saves it to the library', async () => {
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    const editor = await screen.findByTestId('scan-text');
    expect(editor.props.value).toContain('## MEETING NOTES');
    expect(editor.props.value).toContain('- finish the design');
    expect(saveScanToLibrary).toHaveBeenCalledTimes(1);
    expect(useScanSession.getState().itemId).toBe('row1');
  });

  it('saves edits to the library after the user stops typing', async () => {
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    const editor = await screen.findByTestId('scan-text');
    await fireEvent.changeText(editor, 'my edited text');
    await waitFor(() => expect(saveScanText).toHaveBeenLastCalledWith('row1', 'my edited text'), {
      timeout: 3000,
    });
  });

  it('copies markdown, copies plain text and shares', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    const editor = await screen.findByTestId('scan-text');
    const md = editor.props.value as string;
    await fireEvent.press(screen.getByRole('button', { name: 'Copy' }));
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(md);
    await fireEvent.press(screen.getByRole('button', { name: 'Copy plain' }));
    const plain = (Clipboard.setStringAsync as jest.Mock).mock.calls.at(-1)![0] as string;
    expect(plain).toBe(markdownToPlain(md));
    expect(plain).toContain('• finish the design');
    expect(plain).not.toContain('##');
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({ message: md });
    share.mockRestore();
  });

  it('explains when no text was found and does not save an empty scan', async () => {
    mockEngine = new MockOcrEngine({ empty: true });
    useScanSession.getState().start('file:///blank.jpg');
    await render(wrap(<ScanScreen />));
    expect(await screen.findByText(/No text was found/)).toBeTruthy();
    expect(saveScanToLibrary).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy' }).props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('keeps the text and tells the user when the library save fails', async () => {
    (saveScanToLibrary as jest.Mock).mockRejectedValueOnce(new Error('Not enough free storage'));
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    expect(
      await screen.findByText(/Not saved to your library: Not enough free storage/),
    ).toBeTruthy();
    expect((await screen.findByTestId('scan-text')).props.value).toContain('MEETING NOTES');
  });

  it('shows a readable error with details and can try again', async () => {
    mockEngine = new MockOcrEngine({ failWith: new Error('Text recognition failed') });
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    expect(await screen.findByText('Text recognition failed on this photo.')).toBeTruthy();
    expect(screen.getByText(/Details: ocr-failed/)).toBeTruthy();
    mockEngine = new MockOcrEngine();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findByTestId('scan-text')).props.value).toContain('MEETING NOTES');
  });

  it('cancel stops the work and goes back', async () => {
    mockEngine = new MockOcrEngine({ delayMs: 400 });
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockBack).toHaveBeenCalled();
    expect(saveScanToLibrary).not.toHaveBeenCalled();
  });

  it('opens a saved scan straight into the editor without recognising again', async () => {
    const engine = new MockOcrEngine();
    const spy = jest.spyOn(engine, 'recognize');
    mockEngine = engine;
    useScanSession
      .getState()
      .openSaved({ sourceUri: 'file:///o.jpg', text: '# saved note', itemId: 'row9' });
    await render(wrap(<ScanScreen />));
    expect((await screen.findByTestId('scan-text')).props.value).toBe('# saved note');
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('retries with the other writing system', async () => {
    const engine = new MockOcrEngine();
    const spy = jest.spyOn(engine, 'recognize');
    mockEngine = engine;
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    await screen.findByTestId('scan-text');
    expect(spy).toHaveBeenLastCalledWith(
      'file:///page.jpg#work',
      expect.objectContaining({ script: 'latin' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Devanagari' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Run again' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenLastCalledWith(
      'file:///page.jpg#work',
      expect.objectContaining({ script: 'devanagari' }),
    );
  });

  it('uses the writing system chosen in Settings', async () => {
    await useSettingsStore.getState().setScanScript('devanagari');
    const engine = new MockOcrEngine();
    const spy = jest.spyOn(engine, 'recognize');
    mockEngine = engine;
    useScanSession.getState().start('file:///page.jpg');
    await render(wrap(<ScanScreen />));
    await screen.findByTestId('scan-text');
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ script: 'devanagari' }),
    );
    await useSettingsStore.getState().setScanScript('latin');
  });

  it('goes home when there is nothing to scan', async () => {
    await render(wrap(<ScanScreen />));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('markdownToPlain', () => {
  it('strips headings and converts bullets, keeping numbers and nesting', () => {
    expect(markdownToPlain('## Title\n\n- a\n  - b\n1. one  \nplain')).toBe(
      'Title\n\n• a\n  • b\n1. one\nplain',
    );
  });
  it('removes bold markers and collapses extra blank lines', () => {
    expect(markdownToPlain('**bold** text\n\n\n\nnext')).toBe('bold text\n\nnext');
  });
});
