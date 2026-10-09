import { assertStorage, estimatePngBytes, LowStorageError, STORAGE_HEADROOM } from '@/library/library';

jest.mock('expo-file-system', () => ({}));
jest.mock('@/db/client', () => ({ getDb: jest.fn() }));

describe('storage guard', () => {
  it('passes when there is room plus headroom', () => {
    expect(() => assertStorage(1000, 1000 + STORAGE_HEADROOM)).not.toThrow();
  });
  it('throws a friendly LowStorageError when space is short', () => {
    expect(() => assertStorage(1000, 1000 + STORAGE_HEADROOM - 1)).toThrow(LowStorageError);
    try {
      assertStorage(10, 0);
    } catch (e) {
      expect((e as Error).message).toMatch(/free up some space/i);
    }
  });
  it('estimates PNG size proportionally to pixels', () => {
    expect(estimatePngBytes(100, 100)).toBeLessThan(estimatePngBytes(200, 200));
  });
});
