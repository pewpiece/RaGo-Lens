import type { SkImage } from '@shopify/react-native-skia';
import { readAlpha, resizeImage, transformQuarter } from '@/engine/skiaOps';
import { DEFAULT_EDIT_STATE, type EditState } from '@/edit/editState';
import { MaskHistory } from '@/mask/history';
import { maskFromImage, maskToImage, TileImageCache } from '@/mask/maskImage';
import { TiledMask } from '@/mask/tiledMask';
import { makeAnalysis, applySmartStroke, type Analysis } from './analysis';
import { ImagePyramid } from './pyramid';
import { suggestCleanups, type Suggestion } from './suggest';
import { components } from './morph';
import { magicWand, type WandOptions } from './wand';
import {
  adjustSelection,
  applySelectionToMask,
  applyShapeToSelection,
  applyStroke,
  invertSelection,
  mergeSelection,
  selectionIsEmpty,
  upsampleSelection,
  type BrushStroke,
  type SelectMode,
  type SelectionAdjust,
  type SelectionShape,
} from './tileOps';

export interface SmartOptions {
  tolerance: number;
  edgeSensitivity: number;
}

/**
 * One photo being edited: the full-resolution original, the tiled mask, the temporary selection, undo history and
 * the cached display images. The UI subscribes and re-renders when `rev` changes.
 */
export class EditorDoc {
  original: SkImage;
  width: number;
  height: number;
  mask: TiledMask;
  selection: TiledMask;
  readonly history = new MaskHistory();
  maskTiles: TileImageCache;
  selectionTiles: TileImageCache;
  pyramid: ImagePyramid;
  edit: EditState = DEFAULT_EDIT_STATE;
  rev = 0;
  /** The mask changed since it was last saved. */
  dirty = false;
  /** The photo itself was rotated/flipped since it was last saved (the stored original must be rewritten). */
  photoChanged = false;
  suggestions: Suggestion[] | null = null;
  private readonly dismissed = new Set<string>();
  private analysisCache: Analysis | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly id: string | null,
    original: SkImage,
    mask: TiledMask,
  ) {
    this.original = original;
    this.width = original.width();
    this.height = original.height();
    this.mask = mask;
    this.selection = new TiledMask(this.width, this.height, 0);
    this.maskTiles = new TileImageCache(mask);
    this.selectionTiles = new TileImageCache(this.selection);
    this.pyramid = new ImagePyramid(original);
  }

  static fromMaskImage(id: string | null, original: SkImage, maskImage: SkImage): EditorDoc {
    if (maskImage.width() !== original.width() || maskImage.height() !== original.height()) {
      // an older item whose mask is at a different size: bring it to the photo size
      return new EditorDoc(
        id,
        original,
        maskFromImage(resizeImage(maskImage, original.width(), original.height())),
      );
    }
    return new EditorDoc(id, original, maskFromImage(maskImage));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(maskChanged = false): void {
    this.rev++;
    if (maskChanged) {
      this.dirty = true;
      this.suggestions = null;
    }
    for (const l of this.listeners) l();
  }

  get analysis(): Analysis {
    return (this.analysisCache ??= makeAnalysis(this.original));
  }

  // ---------------------------------------------------------------- mask edits

  /** One undoable step. `fn` receives the session to pass to the tile ops. */
  private step(label: string, fn: (s: ReturnType<MaskHistory['begin']>) => void): void {
    const s = this.history.begin(this.mask, label);
    try {
      fn(s);
    } catch (e) {
      s.rollback();
      throw e;
    }
    if (s.commit().length > 0) this.bump(true);
    else this.bump();
  }

  commitStroke(stroke: BrushStroke, smart?: SmartOptions): void {
    if (stroke.points.length === 0) return;
    this.step(stroke.mode === 'erase' ? 'Erase' : 'Restore', (s) => {
      if (smart) applySmartStroke(this.mask, stroke, this.analysis, smart, s);
      else applyStroke(this.mask, stroke, s);
    });
  }

  undo(): void {
    if (this.history.undo(this.mask).length > 0) this.bump(true);
  }
  redo(): void {
    if (this.history.redo(this.mask).length > 0) this.bump(true);
  }

  // ---------------------------------------------------------------- selection

  get hasSelection(): boolean {
    return !selectionIsEmpty(this.selection);
  }

  selectShape(shape: SelectionShape, mode: SelectMode): void {
    applyShapeToSelection(this.selection, shape, mode);
    this.bump();
  }

  /**
   * Tap-to-select: a Lab flood fill on the small analysis copy, upsampled and snapped to the true edges of the
   * full-resolution photo. `at` is in photo pixels. `restrictToCutout` limits it to what is currently kept.
   */
  selectWand(
    at: { x: number; y: number },
    o: WandOptions,
    mode: SelectMode,
    restrictToCutout: boolean,
  ): void {
    const a = this.analysis;
    const restrict = restrictToCutout ? this.maskAtAnalysis() : undefined;
    const small = magicWand(
      a.lab,
      a.w,
      a.h,
      { x: at.x / a.kx, y: at.y / a.ky },
      { ...o, restrictTo: restrict },
    );
    const full = upsampleSelection(small, a.w, a.h, this.original);
    mergeSelection(this.selection, full, mode);
    this.bump();
  }

  /**
   * Select by detected region: tap a piece of the cut-out (a connected part of what is kept), or a closed opening
   * inside it (a hole), and that whole segment is selected. Taps on the open background select nothing.
   */
  selectRegion(at: { x: number; y: number }, mode: SelectMode): boolean {
    const a = this.analysis;
    const alpha = this.maskAtAnalysis();
    const x = Math.min(a.w - 1, Math.max(0, Math.round(at.x / a.kx)));
    const y = Math.min(a.h - 1, Math.max(0, Math.round(at.y / a.ky)));
    const kept = alpha[y * a.w + x]! > 127;
    const set = new Uint8Array(a.w * a.h);
    for (let i = 0; i < set.length; i++) set[i] = alpha[i]! > 127 === kept ? 1 : 0;
    const c = components(set, a.w, a.h);
    const id = c.labels[y * a.w + x]!;
    if (!id) return false;
    if (!kept && c.touchesBorder[id]) return false; // the open background is not a "region"
    const small = new Uint8Array(a.w * a.h);
    for (let i = 0; i < small.length; i++) if (c.labels[i] === id) small[i] = 255;
    mergeSelection(this.selection, upsampleSelection(small, a.w, a.h, this.original, false), mode);
    this.bump();
    return true;
  }

  selectInvert(): void {
    invertSelection(this.selection);
    this.bump();
  }
  selectClear(): void {
    if (!this.hasSelection) return;
    this.selection.clone();
    for (let i = 0; i < this.selection.tileCount; i++)
      this.selection.setTile(
        i,
        new Uint8Array(this.selection.tileRect(i).w * this.selection.tileRect(i).h),
      );
    this.bump();
  }
  selectAdjust(adj: SelectionAdjust): void {
    adjustSelection(this.selection, adj);
    this.bump();
  }

  /** Remove (erase) or Keep (restore) the selected pixels; the selection is cleared afterwards. */
  applySelection(action: 'remove' | 'keep'): void {
    if (!this.hasSelection) return;
    this.step(action === 'remove' ? 'Remove selection' : 'Keep selection', (s) =>
      applySelectionToMask(this.mask, this.selection, action, s),
    );
    this.selectClear();
  }

  // ---------------------------------------------------------------- suggestions

  /** The mask resampled to the analysis size (what the clean-up analysis looks at). */
  maskAtAnalysis(): Uint8Array {
    const a = this.analysis;
    return readAlpha(resizeImage(maskToImage(this.mask), a.w, a.h));
  }

  computeSuggestions(): Suggestion[] {
    if (!this.suggestions) {
      const a = this.analysis;
      this.suggestions = suggestCleanups({
        rgba: a.rgba,
        alpha: this.maskAtAnalysis(),
        w: a.w,
        h: a.h,
      });
    }
    return this.suggestions.filter((s) => !this.dismissed.has(s.id));
  }

  dismissSuggestion(id: string): void {
    this.dismissed.add(id);
    this.bump();
  }

  /** Applies one suggestion (an undoable step). Never called automatically. */
  acceptSuggestion(id: string): void {
    this.computeSuggestions(); // re-measured on the current mask if an earlier step invalidated them
    const sug = this.suggestions?.find((s) => s.id === id);
    if (!sug) return;
    const a = this.analysis;
    const small = new Uint8Array(a.w * a.h);
    const [l, t, r, b] = sug.bbox;
    for (let y = t; y < b; y++)
      for (let x = l; x < r; x++)
        if (sug.region[(y - t) * (r - l) + (x - l)]) small[y * a.w + x] = 255;
    const sel = upsampleSelection(small, a.w, a.h, this.original, false);
    // the remaining suggestions were measured on the old mask: they are recomputed from the new one
    this.step(sug.label, (s) => applySelectionToMask(this.mask, sel, sug.action, s));
  }

  // ---------------------------------------------------------------- orientation

  /** Rotates/mirrors the photo and its mask together (exact pixel moves). Clears history and selection. */
  transformPhoto(quarterTurns: number, flipH = false, flipV = false): void {
    const original = transformQuarter(this.original, quarterTurns, flipH, flipV);
    const mask = maskFromImage(
      transformQuarter(maskToImage(this.mask), quarterTurns, flipH, flipV),
    );
    this.original = original;
    this.width = original.width();
    this.height = original.height();
    this.mask = mask;
    this.selection = new TiledMask(this.width, this.height, 0);
    this.maskTiles = new TileImageCache(mask);
    this.selectionTiles = new TileImageCache(this.selection);
    this.pyramid = new ImagePyramid(original);
    this.analysisCache = null;
    this.history.clear();
    this.photoChanged = true;
    this.bump(true);
  }

  /** Mask as a compact Alpha_8 image (for export and saving). */
  maskImage(): SkImage {
    return maskToImage(this.mask);
  }
}
