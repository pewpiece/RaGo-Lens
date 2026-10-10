import type { BackgroundState, CanvasState, ShadowState } from '@/edit/editState';
import seed from './seed.json';

/**
 * Output presets are plain data the user can edit. The seeded ones are generic starting points: marketplace rules
 * differ and change over time, so verify the values against each platform's current guidelines before relying on them.
 */
export interface Preset {
  id: string;
  name: string;
  canvas: Pick<CanvasState, 'aspect' | 'width' | 'height' | 'paddingPercent'>;
  background: BackgroundState;
  /** Share of the canvas the product should fill along its tighter axis. */
  fill: { min: number; max: number; target: number };
  shadow: ShadowState['kind'];
  format: 'png' | 'jpeg';
  /** 1..100, JPEG only. */
  jpegQuality: number;
  /** Largest allowed file, in KB; null = no limit. */
  maxFileKB: number | null;
}

const ASPECTS = ['original', '1:1', '4:5', '3:4', '16:9', '9:16', 'custom'] as const;
const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Defensive parse of a stored preset: invalid fields fall back to safe values, so a bad row can never crash the app. */
export function parsePreset(id: string, name: string, json: string): Preset {
  let j: Record<string, unknown> = {};
  try {
    j = obj(JSON.parse(json));
  } catch {
    j = {};
  }
  const c = obj(j.canvas);
  const b = obj(j.background);
  const f = obj(j.fill);
  const min = num(f.min, 0.7, 0.05, 1);
  const max = Math.max(min, num(f.max, 0.95, 0.05, 1));
  const aspect = ASPECTS.includes(c.aspect as (typeof ASPECTS)[number])
    ? (c.aspect as Preset['canvas']['aspect'])
    : 'original';
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
  const shadows = ['none', 'contact', 'drop', 'natural'] as const;
  return {
    id,
    name: name.trim() || 'Untitled preset',
    canvas: {
      aspect,
      width: Math.round(num(c.width, 2000, 16, 12000)),
      height: Math.round(num(c.height, 2000, 16, 12000)),
      paddingPercent: num(c.paddingPercent, 4, 0, 40),
    },
    background,
    fill: {
      min,
      max,
      target: Math.min(max, Math.max(min, num(f.target, (min + max) / 2, 0.05, 1))),
    },
    shadow: shadows.includes(j.shadow as (typeof shadows)[number])
      ? (j.shadow as Preset['shadow'])
      : 'none',
    format: j.format === 'jpeg' ? 'jpeg' : 'png',
    jpegQuality: Math.round(num(j.jpegQuality, 92, 40, 100)),
    maxFileKB: typeof j.maxFileKB === 'number' && j.maxFileKB > 0 ? Math.round(j.maxFileKB) : null,
  };
}

/** The part of a preset that is stored as JSON in the table (id and name are columns). */
export const presetJson = (p: Preset): string =>
  JSON.stringify({
    canvas: p.canvas,
    background: p.background,
    fill: p.fill,
    shadow: p.shadow,
    format: p.format,
    jpegQuality: p.jpegQuality,
    maxFileKB: p.maxFileKB,
  });

export const SEED_PRESETS: Preset[] = (seed as { id: string; name: string; json: unknown }[]).map(
  (s) => parsePreset(s.id, s.name, JSON.stringify(s.json)),
);

export function duplicatePreset(p: Preset, id: string): Preset {
  return { ...p, id, name: `${p.name} copy` };
}
