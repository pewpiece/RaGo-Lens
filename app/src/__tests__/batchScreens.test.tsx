import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import initSqlJs from 'sql.js';
import BatchRun from '@/app/batch-run';
import BatchReview from '@/app/batch-review';
import NewBatch from '@/app/batch';
import { BatchRunner, DEFAULT_BATCH_OPTIONS, createBatch } from '@/batch/queue';
import { listBatchItems } from '@/db/batchRepo';
import type { SyncDb } from '@/db/kv';
import { ThemeProvider } from '@/theme/ThemeProvider';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
let mockProcess: (item: {
  name: string;
}) => Promise<{ resultId: string; needsReview: boolean }> = async (i) => ({
  resultId: `r-${i.name}`,
  needsReview: false,
});
const mockExported: string[] = [];
let mockExportFail: string | null = null;
let mockDb: SyncDb;

jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(cb, []); // eslint-disable-line react-hooks/exhaustive-deps
  },
}));
jest.mock('@/store/instances', () => {
  const { memoryKv } = jest.requireActual('@/db/kv');
  const { createSettingsStore } = jest.requireActual('@/store/settingsStore');
  const { createThemeStore } = jest.requireActual('@/store/themeStore');
  const kv = memoryKv();
  return { useThemeStore: createThemeStore(kv), useSettingsStore: createSettingsStore(kv) };
});
jest.mock('@/db/client', () => ({ getDb: () => mockDb }));
jest.mock('expo-file-system', () => ({
  Directory: { pickDirectoryAsync: jest.fn(async () => ({ uri: 'file:///folder' })) },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [
      { uri: 'file:///a/IMG_1.jpg', fileName: 'IMG_1.jpg' },
      { uri: 'file:///a/IMG_2.jpg', fileName: 'IMG_2.jpg' },
      { uri: 'file:///a/IMG_3.jpg', fileName: 'IMG_3.jpg' },
    ],
  })),
}));
jest.mock('@/library/library', () => ({
  getItem: (id: string) => ({
    id,
    thumbUri: `file:///t/${id}.png`,
    originalUri: 'o',
    resultUri: 'r',
    settingsJson: '{}',
    editStateJson: '{}',
  }),
  setItemStatus: jest.fn(),
}));
jest.mock('@/library/openItem', () => ({
  loadItem: jest.fn(async () => ({ original: {}, maskLayer: {}, width: 1, height: 1 })),
}));
jest.mock('@/export/actions', () => ({
  shareFile: jest.fn(),
  writeVerifiedComposite: jest.fn(),
  ExportError: class extends Error {},
}));
jest.mock('@/batch/service', () => {
  const { BatchRunner: R } = jest.requireActual('@/batch/queue');
  const naming = jest.requireActual('@/batch/naming');
  return {
    deviceBatchRunner: (onUpdate: () => void) =>
      new R({ db: mockDb, onUpdate, processItem: (item: { name: string }) => mockProcess(item) }),
    exportBatchItem: jest.fn(async (row: { id: string }, _preset: unknown, name: string) => {
      if (mockExportFail === row.id) throw new Error('disk full');
      mockExported.push(name);
      return { name, width: 1, height: 1 };
    }),
    batchFileNames: (
      items: { name: string; sku: string; position: number }[],
      preset: { name?: string; format?: string } | null,
      template: string,
    ) =>
      naming.uniqueNames(
        items.map((it) =>
          naming.formatName(
            template,
            {
              name: it.name,
              sku: it.sku,
              index: it.position + 1,
              total: items.length,
              preset: preset?.name ?? 'original',
            },
            preset?.format === 'jpeg' ? 'jpg' : 'png',
          ),
        ),
      ),
  };
});

const wrap = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

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
  mockDb = drizzle(raw, { schema });
});

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockExported.length = 0;
  mockExportFail = null;
  mockProcess = async (i) => ({ resultId: `r-${i.name}`, needsReview: false });
});

const seed = (id: string, n: number) =>
  createBatch(mockDb, {
    id,
    name: `Batch ${id}`,
    sources: Array.from({ length: n }, (_, i) => ({ uri: `file:///p${i}.jpg`, name: `p${i}` })),
    options: { ...DEFAULT_BATCH_OPTIONS, naming: '{sku}{name}', skuPrefix: 'X-' },
  });

describe('New batch screen', () => {
  it('picks photos, previews the first file name and creates the batch', async () => {
    await render(wrap(<NewBatch />));
    await fireEvent.press(screen.getByTestId('pick-photos'));
    expect(await screen.findByText(/3 photos chosen/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('SKU prefix'), 'SH-');
    await fireEvent.changeText(screen.getByLabelText('Naming template'), '{sku}_{name}');
    expect(screen.getByText(/First file: SH-1_IMG_1\.(jpg|png)/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('start-batch'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    const id = (mockReplace.mock.calls[0]![0] as { params: { id: string } }).params.id;
    const items = listBatchItems(mockDb, id);
    expect(items.map((i) => [i.name, i.sku])).toEqual([
      ['IMG_1', 'SH-1'],
      ['IMG_2', 'SH-2'],
      ['IMG_3', 'SH-3'],
    ]);
  });
});

describe('Batch run screen', () => {
  it('runs the queue, shows per-photo status, and offers review for flagged photos', async () => {
    seed('run1', 3);
    mockParams = { id: 'run1' };
    mockProcess = async (i) => ({ resultId: `r-${i.name}`, needsReview: i.name === 'p1' });
    await render(wrap(<BatchRun />));
    await waitFor(() => expect(screen.getByText(/Done, some need a look/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByText(/3 of 3 done · 1 need a look/)).toBeTruthy();
    expect(screen.getByTestId('item-1')).toHaveTextContent(/Needs a look/);
    await fireEvent.press(screen.getByTestId('batch-review'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/batch-review', params: { id: 'run1' } });
  });

  it('a failing photo is reported with its reason and can be retried', async () => {
    seed('run2', 2);
    mockParams = { id: 'run2' };
    let fail = true;
    mockProcess = async (i) => {
      if (i.name === 'p0' && fail) throw new Error('Could not read this photo');
      return { resultId: `r-${i.name}`, needsReview: false };
    };
    await render(wrap(<BatchRun />));
    await waitFor(() => expect(screen.getByText(/Done, some failed/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(screen.getByTestId('item-0')).toHaveTextContent(/Failed: Could not read this photo/);
    fail = false;
    await fireEvent.press(screen.getByTestId('batch-retry'));
    await waitFor(() => expect(screen.getByText('All done')).toBeTruthy(), { timeout: 5000 });
  });

  it('resumes a batch that was interrupted (an item left "processing") when the screen opens', async () => {
    seed('run3', 3);
    const { updateBatchItem } = require('@/db/batchRepo');
    const items = listBatchItems(mockDb, 'run3');
    updateBatchItem(mockDb, items[0]!.id, { status: 'done', resultId: 'r-p0' });
    updateBatchItem(mockDb, items[1]!.id, { status: 'processing' });
    mockParams = { id: 'run3' };
    const seen: string[] = [];
    mockProcess = async (i) => {
      seen.push(i.name);
      return { resultId: `r-${i.name}`, needsReview: false };
    };
    await render(wrap(<BatchRun />));
    await waitFor(() => expect(screen.getByText('All done')).toBeTruthy(), { timeout: 5000 });
    expect(seen).toEqual(['p1', 'p2']);
  });

  it('exports every finished photo with the naming template, and lists the ones that failed', async () => {
    seed('run4', 3);
    mockParams = { id: 'run4' };
    await render(wrap(<BatchRun />));
    await waitFor(() => expect(screen.getByText('All done')).toBeTruthy(), { timeout: 5000 });
    await fireEvent.changeText(screen.getByLabelText('File name template'), '{sku}_{name}');
    mockExportFail = 'r-p1';
    await fireEvent.press(screen.getByTestId('batch-export'));
    await waitFor(() => expect(screen.getByText(/Exported 2 of 3/)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(mockExported).toEqual(['X-1_p0.png', 'X-3_p2.png']);
    expect(screen.getByText(/p1: disk full/)).toBeTruthy();
  });
});

describe('Batch review screen', () => {
  it('shows only flagged photos; "Looks fine" clears one, Skip moves on, editing opens the editor', async () => {
    seed('rev', 3);
    const { updateBatchItem } = require('@/db/batchRepo');
    const items = listBatchItems(mockDb, 'rev');
    items.forEach((i) =>
      updateBatchItem(mockDb, i.id, {
        status: i.position === 1 ? 'done' : 'needs_review',
        resultId: `r-${i.name}`,
      }),
    );
    mockParams = { id: 'rev' };
    await render(wrap(<BatchReview />));
    expect(screen.getByText('p0')).toBeTruthy();
    expect(screen.getByText(/2 left to look at/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('review-approve'));
    await waitFor(() => expect(screen.getByText('p2')).toBeTruthy());
    expect(listBatchItems(mockDb, 'rev')[0]!.status).toBe('done');
    await fireEvent.press(screen.getByTestId('review-edit'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/editor'));
    await fireEvent.press(screen.getByTestId('review-skip'));
    expect(await screen.findByText('You skipped the rest')).toBeTruthy();
  });
});

void BatchRunner;
