export type ExportBackground = 'transparent' | 'white' | 'color' | 'shadow';
export type ExportSize = 'original' | 2048 | 1024;

export interface ExportOptions {
  background: ExportBackground;
  /** #RRGGBB, used when background === 'color'. */
  color: string;
  autoCrop: boolean;
  /** Padding around the object after auto-crop, as a percent of the object's longer side. */
  paddingPercent: number;
  size: ExportSize;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  background: 'transparent',
  color: '#FFFFFF',
  autoCrop: true,
  paddingPercent: 4,
  size: 'original',
};

const BACKGROUNDS: ExportBackground[] = ['transparent', 'white', 'color', 'shadow'];

/** Defensive parse of persisted JSON: unknown/invalid fields fall back to defaults. */
export function parseExportOptions(raw: string | null | undefined): ExportOptions {
  const d = DEFAULT_EXPORT_OPTIONS;
  if (!raw) return d;
  try {
    const o = JSON.parse(raw) as Partial<ExportOptions>;
    return {
      background: BACKGROUNDS.includes(o.background as ExportBackground)
        ? (o.background as ExportBackground)
        : d.background,
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : d.color,
      autoCrop: typeof o.autoCrop === 'boolean' ? o.autoCrop : d.autoCrop,
      paddingPercent:
        typeof o.paddingPercent === 'number' && o.paddingPercent >= 0 && o.paddingPercent <= 25
          ? o.paddingPercent
          : d.paddingPercent,
      size: o.size === 2048 || o.size === 1024 || o.size === 'original' ? o.size : d.size,
    };
  } catch {
    return d;
  }
}
