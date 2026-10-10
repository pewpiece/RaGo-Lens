import { rleDecode, rleEncode } from './rle';
import type { TiledMask } from './tiledMask';

interface TileChange {
  index: number;
  before: Uint8Array;
  after: Uint8Array;
}

interface Step {
  label: string;
  changes: TileChange[];
}

export const MAX_HISTORY_STEPS = 50;

/**
 * Undo/redo for a TiledMask as per-tile diffs: each step stores the RLE-compressed `before` and `after` bytes of
 * only the tiles it changed, never a full mask copy. 50 steps by default; the oldest drop off the bottom.
 */
export class MaskHistory {
  private steps: Step[] = [];
  private cursor = 0; // steps[0..cursor) are applied

  constructor(private readonly max = MAX_HISTORY_STEPS) {}

  get canUndo(): boolean {
    return this.cursor > 0;
  }
  get canRedo(): boolean {
    return this.cursor < this.steps.length;
  }
  get size(): number {
    return this.steps.length;
  }
  /** Bytes of compressed history held, for tests and diagnostics. */
  get bytes(): number {
    let n = 0;
    for (const s of this.steps) for (const c of s.changes) n += c.before.length + c.after.length;
    return n;
  }
  get undoLabel(): string | null {
    return this.cursor > 0 ? this.steps[this.cursor - 1]!.label : null;
  }

  /**
   * Starts an edit. Call `touch(tileIndex)` BEFORE changing a tile (the snapshot is taken then), change the mask,
   * then `commit()`. Tiles whose bytes ended up unchanged are dropped; an edit that changed nothing records nothing.
   */
  begin(mask: TiledMask, label: string): EditSession {
    return new EditSession(this, mask, label);
  }

  /** @internal */
  push(step: Step): void {
    this.steps.length = this.cursor; // a new edit invalidates redo
    this.steps.push(step);
    if (this.steps.length > this.max) this.steps.shift();
    this.cursor = this.steps.length;
  }

  /** Reverts the last step; returns the changed tile indices (so display can refresh them). */
  undo(mask: TiledMask): number[] {
    if (!this.canUndo) return [];
    const step = this.steps[--this.cursor]!;
    return apply(mask, step, 'before');
  }

  redo(mask: TiledMask): number[] {
    if (!this.canRedo) return [];
    const step = this.steps[this.cursor++]!;
    return apply(mask, step, 'after');
  }

  clear(): void {
    this.steps = [];
    this.cursor = 0;
  }
}

function apply(mask: TiledMask, step: Step, which: 'before' | 'after'): number[] {
  const out: number[] = [];
  for (const c of step.changes) {
    const r = mask.tileRect(c.index);
    mask.setTile(c.index, rleDecode(c[which], r.w * r.h));
    out.push(c.index);
  }
  return out;
}

export class EditSession {
  private readonly before = new Map<number, Uint8Array>();
  private done = false;

  constructor(
    private readonly history: MaskHistory,
    private readonly mask: TiledMask,
    private readonly label: string,
  ) {}

  /** Snapshot a tile (once) before it is modified. */
  touch(index: number): void {
    if (this.done || this.before.has(index)) return;
    this.before.set(index, rleEncode(this.mask.getTile(index)));
  }

  /** Records the step. Returns the indices of tiles that really changed. */
  commit(): number[] {
    if (this.done) return [];
    this.done = true;
    const changes: TileChange[] = [];
    for (const [index, before] of this.before) {
      const after = rleEncode(this.mask.getTile(index));
      if (before.length === after.length && before.every((v, i) => v === after[i])) continue;
      changes.push({ index, before, after });
    }
    if (changes.length > 0) this.history.push({ label: this.label, changes });
    return changes.map((c) => c.index);
  }

  /** Abandons the edit and restores every touched tile. */
  rollback(): void {
    if (this.done) return;
    this.done = true;
    for (const [index, before] of this.before) {
      const r = this.mask.tileRect(index);
      this.mask.setTile(index, rleDecode(before, r.w * r.h));
    }
  }
}
