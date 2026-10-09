export type BrushMode = 'erase' | 'restore';

/** 'brush' paints along the path; 'area' fills the closed outline (lasso). */
export type StrokeShape = 'brush' | 'area';

export interface Point {
  x: number;
  y: number;
}

/** One brush stroke in IMAGE pixel coordinates. */
export interface Stroke {
  id: number;
  mode: BrushMode;
  /** Defaults to 'brush'. */
  shape?: StrokeShape;
  /** Brush diameter in image pixels. */
  size: number;
  /** 0 = hard edge, 1 = very soft. */
  softness: number;
  points: Point[];
}

export interface BrushHistory {
  strokes: Stroke[];
  redo: Stroke[];
}

export const emptyHistory = (): BrushHistory => ({ strokes: [], redo: [] });

export function pushStroke(h: BrushHistory, s: Stroke): BrushHistory {
  return { strokes: [...h.strokes, s], redo: [] }; // a new stroke invalidates the redo stack
}

export function undo(h: BrushHistory): BrushHistory {
  if (h.strokes.length === 0) return h;
  return { strokes: h.strokes.slice(0, -1), redo: [...h.redo, h.strokes[h.strokes.length - 1]!] };
}

export function redo(h: BrushHistory): BrushHistory {
  if (h.redo.length === 0) return h;
  return { strokes: [...h.strokes, h.redo[h.redo.length - 1]!], redo: h.redo.slice(0, -1) };
}

export const canUndo = (h: BrushHistory) => h.strokes.length > 0;
export const canRedo = (h: BrushHistory) => h.redo.length > 0;

/** A lasso outline needs three points to enclose anything. */
export const isUsableStroke = (s: Stroke): boolean =>
  s.shape === 'area' ? s.points.length >= 3 : s.points.length > 0;

/** Blur radius (image px) for a stroke's soft edge. */
export function softnessBlur(size: number, softness: number): number {
  return Math.max(0, size * 0.5 * Math.min(1, Math.max(0, softness)));
}

/** Drops points closer than `minDist` to the previous one (keeps paths light while dragging). */
export function appendPoint(points: Point[], p: Point, minDist: number): Point[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDist) return points;
  return [...points, p];
}
