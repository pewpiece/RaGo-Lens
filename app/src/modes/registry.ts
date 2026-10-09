import type { ThemeTokens } from '@/theme/tokens';

export type ModeId = 'cutout' | 'scan';

export interface ModeDefinition {
  id: ModeId;
  title: string;
  subtitle: string;
  /** Which colour token tints this mode. */
  accent: keyof Pick<ThemeTokens, 'accent' | 'accentScan'>;
  /** Text colour for content placed on the accent fill. */
  onAccent: keyof Pick<ThemeTokens, 'onAccent' | 'onAccentScan'>;
  /** Entry route; null while the mode is not built. */
  route: string | null;
  enabled: boolean;
  /** Engine kind the mode runs. Phase 2 will add 'ocr'. */
  engine: 'segmentation' | 'ocr' | null;
  glyph: string;
}

/**
 * Registry of capture modes. Shared screens (capture, library, export, settings) stay mode-agnostic and
 * look modes up here. Phase 2 enables `scan` by giving it a route and an engine.
 */
export const MODES: readonly ModeDefinition[] = [
  {
    id: 'cutout',
    title: 'Cutout',
    subtitle: 'Remove a background, export a transparent PNG',
    accent: 'accent',
    onAccent: 'onAccent',
    route: '/capture',
    enabled: true,
    engine: 'segmentation',
    glyph: '✂',
  },
  {
    id: 'scan',
    title: 'Scan',
    subtitle: 'Notebook photo to formatted text',
    accent: 'accentScan',
    onAccent: 'onAccentScan',
    route: '/capture?mode=scan',
    enabled: true,
    engine: 'ocr',
    glyph: '☰',
  },
];

export const getMode = (id: string): ModeDefinition | undefined => MODES.find((m) => m.id === id);
export const enabledModes = (): ModeDefinition[] => MODES.filter((m) => m.enabled);
