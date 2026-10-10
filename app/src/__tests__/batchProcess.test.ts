import { baseNameOf, formatName, uniqueNames } from '@/batch/naming';
import { makeBatchProcessor, type ProcessDeps } from '@/batch/process';
import { DEFAULT_BATCH_OPTIONS } from '@/batch/queue';
import { placeProduct, framingStats, canvasSizeFor } from '@/compose/layout';
import { parseEditState } from '@/edit/editState';
import { SEED_PRESETS } from '@/presets/presets';
import type { BatchItemRow, BatchRow } from '@/db/schema';

describe('file naming', () => {
  const v = { name: 'IMG 1234', sku: 'SH-07', index: 7, total: 12, preset: 'Square white' };
  it('fills the tokens, pads the index to the batch size and makes a safe name', () => {
    expect(formatName('{sku}_{name}', v, 'png')).toBe('SH-07_IMG-1234.png');
    expect(formatName('{index}-{preset}', v, '.jpg')).toBe('07-Square-white.jpg');
    expect(formatName('{name}', { ...v, name: 'a/b\\c:d*e?f"g<h>i|j' }, 'png')).toBe(
      'abcdefghij.png',
    );
    expect(formatName('{sku}', { ...v, sku: '' }, 'png')).toBe('image-07.png');
    expect(formatName('{name}', { ...v, name: 'x'.repeat(300) }, 'png').length).toBe(80 + 4);
  });
  it('duplicates get -2, -3 and the original photo name is recovered from a URI', () => {
    expect(uniqueNames(['a.png', 'b.png', 'A.png', 'a.png'])).toEqual([
      'a.png',
      'b.png',
      'A-2.png',
      'a-3.png',
    ]);
    expect(baseNameOf('file:///storage/DCIM/IMG_1234.JPG?x=1')).toBe('IMG_1234');
    expect(baseNameOf('content://media/external/images/media/42')).toBe('42');
    expect(baseNameOf('file:///a/My%20Photo.jpeg')).toBe('My Photo');
  });
});

describe('batch item processing (fakes for the device parts)', () => {
  const batch = (over: Partial<ReturnType<typeof JSON.parse>> = {}): BatchRow => ({
    id: 'b',
    name: 'n',
    presetId: null,
    status: 'queued',
    optionsJson: JSON.stringify({ ...DEFAULT_BATCH_OPTIONS, ...over }),
    createdAt: 0,
  });
  const item: BatchItemRow = {
    id: 'b-0',
    batchId: 'b',
    position: 0,
    sourceUri: 'file:///p.jpg',
    name: 'p',
    sku: '',
    status: 'queued',
    resultId: null,
    error: null,
    updatedAt: 0,
  };
  const result = { foundObject: true, width: 4000, height: 3000 } as never;
  const mk = (over: Partial<ProcessDeps> = {}) => {
    const persisted: { id: string; json: string; status: string }[] = [];
    const deps: ProcessDeps = {
      cutout: async () => result,
      save: async () => ({ id: 'row-1' }),
      suggestionCount: () => 0,
      boundsOf: () => ({ left: 1000, top: 800, right: 2400, bottom: 2000 }), // 1400 x 1200
      preset: (id) => SEED_PRESETS.find((p) => p.id === id) ?? null,
      persist: (id, json, status) => persisted.push({ id, json, status }),
      ...over,
    };
    return { run: makeBatchProcessor(deps), persisted };
  };

  it('applies the preset and frames the product on the same baseline; clean results are ready', async () => {
    const { run, persisted } = mk();
    const out = await run(item, {
      batch: batch({ presetId: 'square-white-2000', framing: { baseline: 0.9 } }),
      signal: new AbortController().signal,
    });
    expect(out).toEqual({ resultId: 'row-1', needsReview: false });
    expect(persisted[0]!.status).toBe('ready');
    const edit = parseEditState(persisted[0]!.json);
    expect(edit.presetId).toBe('square-white-2000');
    expect(edit.background).toEqual({ kind: 'color', color: '#FFFFFF' });
    const canvas = canvasSizeFor(
      edit.canvas,
      { left: 1000, top: 800, right: 2400, bottom: 2000 },
      0,
    );
    const s = framingStats(
      placeProduct(
        { left: 1000, top: 800, right: 2400, bottom: 2000 },
        edit.transform,
        canvas,
        0.85,
      ).box,
      canvas,
    );
    expect(s.fill).toBeCloseTo(0.85, 6);
    expect(s.marginBottom).toBeCloseTo(0.1, 6);
  });

  it('flags the item for review when clean-up findings exist or nothing was found, without touching the cut-out', async () => {
    const a = mk({ suggestionCount: () => 3 });
    expect(
      (await a.run(item, { batch: batch(), signal: new AbortController().signal })).needsReview,
    ).toBe(true);
    expect(a.persisted[0]!.status).toBe('needs_review');
    const b = mk({ cutout: async () => ({ foundObject: false }) as never });
    expect(
      (await b.run(item, { batch: batch(), signal: new AbortController().signal })).needsReview,
    ).toBe(true);
  });

  it('a cancelled run throws instead of saving half a result; an "original" canvas is not re-framed', async () => {
    const ctl = new AbortController();
    const saved: string[] = [];
    const c = mk({
      cutout: async () => (ctl.abort(), result),
      save: async () => (saved.push('x'), { id: 'r' }),
    });
    await expect(c.run(item, { batch: batch(), signal: ctl.signal })).rejects.toThrow(/Cancelled/);
    expect(saved).toEqual([]);
    const d = mk();
    await d.run(item, {
      batch: batch({ presetId: 'transparent-png' }),
      signal: new AbortController().signal,
    });
    const e = parseEditState(d.persisted[0]!.json);
    expect(e.canvas.aspect).toBe('original');
    expect([e.transform.scale, e.transform.cx, e.transform.cy]).toEqual([1, 0.5, 0.5]);
  });
});
