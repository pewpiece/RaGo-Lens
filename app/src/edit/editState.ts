/**
 * Everything about a cut-out that is NOT the photo or the mask. Stored as JSON in `results.edit_state_json`;
 * the exported PNG is always re-rendered from original + mask + this state, so nothing here is destructive.
 */
export interface TransformState {
  /** Degrees, -180..180, clockwise. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** 1 = the product fills the preset's target ratio; 0.5 = half that. */
  scale: number;
  /** Product centre as a fraction of the canvas (0..1). */
  cx: number;
  cy: number;
}

export interface ShadowState {
  kind: 'none' | 'contact' | 'drop' | 'natural';
  /** Blur radius as a fraction of the product's long side. */
  blur: number;
  opacity: number;
  /** Offset as a fraction of the product's long side, and the light angle in degrees (0 = shadow to the right). */
  distance: number;
  angle: number;
  color: string;
  reflection: boolean;
  /** 0..1 how strongly the floor reflection shows at its brightest. */
  reflectionOpacity: number;
}

export type BackgroundState =
  | { kind: 'transparent' }
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number };

export interface CanvasState {
  /** 'original' keeps the photo's own aspect and size; 'custom' uses width x height. */
  aspect: 'original' | '1:1' | '4:5' | '3:4' | '16:9' | '9:16' | 'custom';
  width: number;
  height: number;
  /** Margin kept around the product, percent of the longer canvas side. */
  paddingPercent: number;
}

export interface RefineState {
  /** Edge softness in photo pixels (0 = hard). */
  softness: number;
  /** Positive grows the object, negative shrinks it, in photo pixels. */
  shift: number;
  /** Contour smoothing in photo pixels. */
  smooth: number;
  fineDetail: boolean;
  decontaminate: boolean;
}

export interface EditState {
  version: 1;
  /** Bumped whenever the stored mask file is rewritten. */
  maskRevision: number;
  transform: TransformState;
  shadow: ShadowState;
  background: BackgroundState;
  canvas: CanvasState;
  presetId: string | null;
  refine: RefineState;
}

export const DEFAULT_EDIT_STATE: EditState = {
  version: 1,
  maskRevision: 0,
  transform: { rotation: 0, flipH: false, flipV: false, scale: 1, cx: 0.5, cy: 0.5 },
  shadow: {
    kind: 'none',
    blur: 0.04,
    opacity: 0.35,
    distance: 0.03,
    angle: 90,
    color: '#000000',
    reflection: false,
    reflectionOpacity: 0.25,
  },
  background: { kind: 'transparent' },
  canvas: { aspect: 'original', width: 2000, height: 2000, paddingPercent: 4 },
  presetId: null,
  refine: { softness: 0, shift: 0, smooth: 0, fineDetail: false, decontaminate: true },
};

const num = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const hex = (v: unknown, d: string): string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Defensive parse: unknown or invalid fields fall back to defaults, so old/damaged JSON never crashes the editor. */
export function parseEditState(raw: string | null | undefined): EditState {
  const d = DEFAULT_EDIT_STATE;
  let j: Record<string, unknown> = {};
  try {
    j = raw ? obj(JSON.parse(raw)) : {};
  } catch {
    j = {};
  }
  const t = obj(j.transform);
  const s = obj(j.shadow);
  const b = obj(j.background);
  const c = obj(j.canvas);
  const r = obj(j.refine);
  const kinds = ['none', 'contact', 'drop', 'natural'] as const;
  const aspects = ['original', '1:1', '4:5', '3:4', '16:9', '9:16', 'custom'] as const;
  const background: BackgroundState =
    b.kind === 'color'
      ? { kind: 'color', color: hex(b.color, '#FFFFFF') }
      : b.kind === 'gradient'
        ? {
            kind: 'gradient',
            from: hex(b.from, '#FFFFFF'),
            to: hex(b.to, '#E5E7EB'),
            angle: num(b.angle, 90, -360, 360),
          }
        : { kind: 'transparent' };
  return {
    version: 1,
    maskRevision: Math.round(num(j.maskRevision, 0, 0, 1e9)),
    transform: {
      rotation: num(t.rotation, 0, -180, 180),
      flipH: bool(t.flipH, false),
      flipV: bool(t.flipV, false),
      scale: num(t.scale, 1, 0.05, 8),
      cx: num(t.cx, 0.5, -1, 2),
      cy: num(t.cy, 0.5, -1, 2),
    },
    shadow: {
      kind: kinds.includes(s.kind as (typeof kinds)[number])
        ? (s.kind as (typeof kinds)[number])
        : d.shadow.kind,
      blur: num(s.blur, d.shadow.blur, 0, 0.5),
      opacity: num(s.opacity, d.shadow.opacity, 0, 1),
      distance: num(s.distance, d.shadow.distance, 0, 0.5),
      angle: num(s.angle, d.shadow.angle, -360, 360),
      color: hex(s.color, d.shadow.color),
      reflection: bool(s.reflection, false),
      reflectionOpacity: num(s.reflectionOpacity, d.shadow.reflectionOpacity, 0, 1),
    },
    background,
    canvas: {
      aspect: aspects.includes(c.aspect as (typeof aspects)[number])
        ? (c.aspect as (typeof aspects)[number])
        : d.canvas.aspect,
      width: Math.round(num(c.width, d.canvas.width, 16, 12000)),
      height: Math.round(num(c.height, d.canvas.height, 16, 12000)),
      paddingPercent: num(c.paddingPercent, d.canvas.paddingPercent, 0, 40),
    },
    presetId: typeof j.presetId === 'string' ? j.presetId : null,
    refine: {
      softness: num(r.softness, 0, 0, 20),
      shift: num(r.shift, 0, -20, 20),
      smooth: num(r.smooth, 0, 0, 20),
      fineDetail: bool(r.fineDetail, false),
      decontaminate: bool(r.decontaminate, true),
    },
  };
}

export const serializeEditState = (s: EditState): string => JSON.stringify(s);
