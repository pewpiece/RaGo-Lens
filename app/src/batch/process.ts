import type { CutoutResult } from '@/engine/pipeline';
import { DEFAULT_EDIT_STATE, serializeEditState, type EditState } from '@/edit/editState';
import type { Box } from '@/compose/layout';
import { canvasSizeFor, framingTransform } from '@/compose/layout';
import { applyPresetToEdit } from '@/presets/applyPreset';
import type { Preset } from '@/presets/presets';
import { parseBatchOptions, type BatchDeps } from './queue';

/** Everything one photo's processing touches, injectable so the logic is tested without a phone. */
export interface ProcessDeps {
  cutout(uri: string, signal: AbortSignal): Promise<CutoutResult>;
  save(result: CutoutResult): Promise<{ id: string }>;
  /** Number of clean-up suggestions (specks, attached pieces, holes, pin-holes) on the cut-out. */
  suggestionCount(result: CutoutResult): number;
  boundsOf(result: CutoutResult): Box | null;
  preset(id: string | null): Preset | null;
  persist(rowId: string, editStateJson: string, status: 'ready' | 'needs_review'): void;
}

/**
 * One batch item: cut out, save to the library, look for things a person should check, and prepare the edit state
 * (the preset applied and the product framed the same way as its siblings). Findings never change the cut-out by themselves:
 * the item is flagged `needs_review` and the review screen shows exactly those.
 */
export function makeBatchProcessor(deps: ProcessDeps): BatchDeps['processItem'] {
  return async (item, { batch, signal }) => {
    const options = parseBatchOptions(batch.optionsJson);
    const result = await deps.cutout(item.sourceUri, signal);
    if (signal.aborted) throw new Error('Cancelled');
    const row = await deps.save(result);
    const preset = deps.preset(options.presetId);
    let edit: EditState = DEFAULT_EDIT_STATE;
    if (preset) edit = applyPresetToEdit(edit, preset);
    const bounds = deps.boundsOf(result);
    if (bounds) {
      const canvas = canvasSizeFor(edit.canvas, bounds, edit.transform.rotation);
      // 'original' canvases are the product's own size: framing only matters for fixed canvases
      if (edit.canvas.aspect !== 'original') {
        edit = {
          ...edit,
          transform: framingTransform(
            bounds,
            edit.transform,
            canvas,
            preset?.fill.target ?? 0.85,
            options.framing,
          ),
        };
      }
    }
    const needsReview = !result.foundObject || deps.suggestionCount(result) > 0;
    deps.persist(row.id, serializeEditState(edit), needsReview ? 'needs_review' : 'ready');
    return { resultId: row.id, needsReview };
  };
}
