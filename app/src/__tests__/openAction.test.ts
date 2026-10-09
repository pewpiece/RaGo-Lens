import { Alert } from 'react-native';
import { openLibraryItem } from '@/library/openAction';
import { loadItem } from '@/library/openItem';
import { useSession } from '@/store/session';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/library/openItem', () => ({ loadItem: jest.fn() }));

const row = (mode: string) => ({
  id: 'a',
  mode,
  originalUri: 'file:///o.jpg',
  resultUri: '',
  thumbUri: '',
  width: 1,
  height: 1,
  settingsJson: '{}',
  createdAt: 1,
});

beforeEach(() => {
  jest.clearAllMocks();
  useSession.getState().clear();
});

describe('openLibraryItem', () => {
  it('loads a cutout item into the session and opens the result screen', async () => {
    (loadItem as jest.Mock).mockResolvedValueOnce({ width: 1, height: 1 });
    await openLibraryItem(row('cutout') as never);
    expect(useSession.getState().itemId).toBe('a');
    expect(useSession.getState().result).toEqual({ width: 1, height: 1 });
    expect(mockPush).toHaveBeenCalledWith('/result');
  });

  it('refuses items from modes that are not enabled yet', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openLibraryItem(row('scan') as never);
    expect(alert).toHaveBeenCalled();
    expect(loadItem).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('reports files that cannot be read instead of crashing', async () => {
    (loadItem as jest.Mock).mockRejectedValueOnce(new Error('file not found'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openLibraryItem(row('cutout') as never);
    expect(alert).toHaveBeenCalledWith(
      expect.stringMatching(/could not open/i),
      expect.any(String),
    );
    expect(mockPush).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
