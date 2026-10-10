import { File } from 'expo-file-system';
import type { Directory } from 'expo-file-system';
import { devicePipelineDeps, getEngine } from '@/engine/factory';
import { runCutout } from '@/engine/pipeline';
import { getDb } from '@/db/client';
import type { SyncDb } from '@/db/kv';
import type { BatchItemRow, ResultRow } from '@/db/schema';
import { DEFAULT_EDIT_STATE, parseEditState } from '@/edit/editState';
import { saveToGallery, writeVerifiedComposite, ExportError } from '@/export/actions';
import { loadSourceFromRow, sourceFromParts, toProductInputs } from '@/export/productSource';
import { renderComposite, type OutputFormat } from '@/compose/render';
import { saveEditState, setItemStatus } from '@/library/library';
import { saveResultToLibrary } from '@/library/saveResult';
import { maskFromImage } from '@/mask/maskImage';
import { maskTightBounds } from '@/mask/bounds';
import type { Preset } from '@/presets/presets';
import { loadPresets } from '@/presets/store';
import { cleanupCounts } from '@/readiness/analyze';
import { useSettingsStore } from '@/store/instances';
import { BatchRunner } from './queue';
import { makeBatchProcessor } from './process';
import { formatName, uniqueNames } from './naming';

const db = () => getDb() as unknown as SyncDb;

/** The batch runner wired to the real engine, library and database. */
export function deviceBatchRunner(onUpdate?: () => void): BatchRunner {
  const settings = () => useSettingsStore.getState();
  const processItem = makeBatchProcessor({
    cutout: (uri, signal) =>
      runCutout(
        {
          uri,
          cap: settings().workingSizeCap,
          engine: getEngine(settings().useMockEngine, settings().remote),
          edge: settings().edgeLevel,
          signal,
        },
        devicePipelineDeps,
      ),
    save: (result) =>
      saveResultToLibrary(result, settings().workingSizeCap, settings().autoEnhance.exportToo),
    exportEnhanced: () => settings().autoEnhance.exportToo,
    suggestionCount: (result) => {
      const src = sourceFromParts(
        result.original,
        maskFromImage(result.maskLayer),
        DEFAULT_EDIT_STATE,
      );
      const c = cleanupCounts(src);
      return c.specks + c.blobs + c.holes + c.pinholes;
    },
    boundsOf: (result) => maskTightBounds(maskFromImage(result.maskLayer)),
    preset: (id) => (id ? (loadPresets(db()).find((p) => p.id === id) ?? null) : null),
    persist: (rowId, json, status) => {
      saveEditState(rowId, json);
      setItemStatus(rowId, status);
    },
  });
  return new BatchRunner({ db: db(), processItem, concurrency: 1, onUpdate });
}

export type ExportDestination = { kind: 'gallery' } | { kind: 'folder'; directory: Directory };

export interface ExportedItem {
  name: string;
  width: number;
  height: number;
  warning?: string;
}

/** Renders one stored item with its own edit state and its batch's preset, verifies the file and puts it at the destination. */
export async function exportBatchItem(
  row: ResultRow,
  preset: Preset | null,
  fileName: string,
  dest: ExportDestination,
): Promise<ExportedItem> {
  const src = await loadSourceFromRow(row);
  const product = await toProductInputs(src);
  const edit = parseEditState(row.editStateJson);
  const fmt: OutputFormat = preset
    ? {
        format: preset.format,
        quality: preset.jpegQuality,
        maxBytes: preset.maxFileKB ? preset.maxFileKB * 1024 : null,
      }
    : { format: 'png', quality: 100, maxBytes: null };
  const r = await renderComposite(
    product,
    {
      canvas: edit.canvas,
      transform: edit.transform,
      shadow: edit.shadow,
      background: edit.background,
      fill: preset?.fill.target ?? 0.85,
    },
    fmt,
  );
  const uri = writeVerifiedComposite(r, fileName);
  if (dest.kind === 'gallery') await saveToGallery(uri);
  else {
    try {
      let name = fileName;
      let target = new File(dest.directory, name);
      for (let n = 2; target.exists && n < 1000; n++) {
        const dot = fileName.lastIndexOf('.');
        name = `${fileName.slice(0, dot)}-${n}${fileName.slice(dot)}`;
        target = new File(dest.directory, name);
      }
      target.create();
      target.write(r.bytes);
    } catch (e) {
      throw new ExportError('failed', `Could not write to that folder: ${(e as Error).message}`);
    }
  }
  return {
    name: fileName,
    width: r.width,
    height: r.height,
    warning: r.overLimit ? 'over the size limit' : undefined,
  };
}

/** File names for a whole batch (unique, from the naming template). */
export function batchFileNames(
  items: BatchItemRow[],
  preset: Preset | null,
  template: string,
): string[] {
  const ext = preset?.format === 'jpeg' ? 'jpg' : 'png';
  return uniqueNames(
    items.map((it) =>
      formatName(
        template,
        {
          name: it.name,
          sku: it.sku,
          index: it.position + 1,
          total: items.length,
          preset: preset?.name ?? 'original',
        },
        ext,
      ),
    ),
  );
}
