import { twoFinger, type TwoFinger } from '@/scene/viewTransform';

export interface Pt {
  x: number;
  y: number;
}

/**
 * What one finger does:
 *  - stroke: draws while it moves (brushes)
 *  - shape: drags out a rectangle/ellipse/lasso
 *  - tap: a quick touch selects (wand, polygon points, straight-line ends)
 *  - pan: moves the view (hand mode)
 * Two fingers ALWAYS pan and zoom, whatever the tool, and cancel whatever one finger had started, so editing never
 * fights navigation and a second finger landing mid-stroke can never leave a stray mark.
 */
export type OneFingerMode = 'stroke' | 'shape' | 'tap' | 'pan';

export interface GestureHandlers {
  onStrokeBegin(p: Pt): void;
  onStrokeMove(p: Pt): void;
  onStrokeEnd(): void;
  onStrokeCancel(): void;
  onShapeBegin(p: Pt): void;
  onShapeMove(from: Pt, to: Pt): void;
  onShapeEnd(from: Pt, to: Pt): void;
  onShapeCancel(): void;
  onTap(p: Pt): void;
  onDoubleTap(p: Pt): void;
  onPan(dx: number, dy: number): void;
  onPinch(prev: TwoFinger, next: TwoFinger): void;
}

export const TAP_SLOP = 8;
export const TAP_MAX_MS = 350;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_DIST = 40;

export class GestureController {
  /** Used when no `modeOf` is given (tests). */
  mode: OneFingerMode = 'stroke';
  private phase: 'idle' | 'single' | 'multi' = 'idle';
  private start: Pt = { x: 0, y: 0 };
  private last: Pt = { x: 0, y: 0 };
  private startTime = 0;
  private moved = false;
  private active: 'none' | 'stroke' | 'shape' = 'none';
  private pinch: TwoFinger | null = null;
  private lastTap: { p: Pt; t: number } | null = null;

  constructor(
    private readonly h: GestureHandlers,
    private readonly modeOf?: () => OneFingerMode,
  ) {}

  private get m(): OneFingerMode {
    return this.modeOf ? this.modeOf() : this.mode;
  }

  touchStart(touches: Pt[], now: number): void {
    if (touches.length >= 2) return this.toMulti(touches);
    if (this.phase === 'multi') return; // wait for all fingers to lift
    const p = touches[0]!;
    this.phase = 'single';
    this.start = p;
    this.last = p;
    this.startTime = now;
    this.moved = false;
    if (this.m === 'stroke') {
      this.active = 'stroke';
      this.h.onStrokeBegin(p);
    }
  }

  touchMove(touches: Pt[], _now: number): void {
    if (touches.length >= 2) {
      if (this.phase !== 'multi') this.toMulti(touches);
      const next = twoFinger(touches[0]!, touches[1]!);
      if (this.pinch) this.h.onPinch(this.pinch, next);
      this.pinch = next;
      return;
    }
    if (this.phase !== 'single') return;
    const p = touches[0]!;
    if (!this.moved && Math.hypot(p.x - this.start.x, p.y - this.start.y) > TAP_SLOP)
      this.moved = true;
    if (this.m === 'stroke') {
      this.h.onStrokeMove(p);
    } else if (this.m === 'shape') {
      if (this.moved) {
        if (this.active !== 'shape') {
          this.active = 'shape';
          this.h.onShapeBegin(this.start);
        }
        this.h.onShapeMove(this.start, p);
      }
    } else if (this.m === 'pan') {
      this.h.onPan(p.x - this.last.x, p.y - this.last.y);
    }
    this.last = p;
  }

  touchEnd(now: number): void {
    const wasSingle = this.phase === 'single';
    if (wasSingle) {
      if (this.active === 'stroke') this.h.onStrokeEnd();
      else if (this.active === 'shape') this.h.onShapeEnd(this.start, this.last);
      else if (
        !this.moved &&
        now - this.startTime <= TAP_MAX_MS &&
        (this.m === 'tap' || this.m === 'shape' || this.m === 'pan')
      ) {
        const lt = this.lastTap;
        if (
          lt &&
          now - lt.t <= DOUBLE_TAP_MS &&
          Math.hypot(this.start.x - lt.p.x, this.start.y - lt.p.y) <= DOUBLE_TAP_DIST
        ) {
          this.lastTap = null;
          this.h.onDoubleTap(this.start);
        } else {
          this.lastTap = { p: this.start, t: now };
          if (this.m === 'tap') this.h.onTap(this.start);
        }
      }
    }
    this.reset();
  }

  /** The system took the gesture away (e.g. a notification): drop anything half done. */
  cancel(): void {
    this.dropActive();
    this.reset();
  }

  private toMulti(touches: Pt[]): void {
    this.dropActive();
    this.phase = 'multi';
    this.pinch = twoFinger(touches[0]!, touches[1]!);
    this.lastTap = null;
  }

  private dropActive(): void {
    if (this.active === 'stroke') this.h.onStrokeCancel();
    if (this.active === 'shape') this.h.onShapeCancel();
    this.active = 'none';
  }

  private reset(): void {
    this.phase = 'idle';
    this.active = 'none';
    this.pinch = null;
    this.moved = false;
  }
}
