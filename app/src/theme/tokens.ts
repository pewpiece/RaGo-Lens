export type ThemeScheme = 'light' | 'dark';
export type ThemeMode = 'system' | ThemeScheme;

export interface ThemeTokens {
  scheme: ThemeScheme;
  background: string;
  surface: string;
  surfaceRaised: string;
  /** Hairline for cards and dividers (decorative). */
  border: string;
  /** Outline for interactive controls; meets the 3:1 non-text contrast minimum. */
  borderStrong: string;
  text: string;
  textMuted: string;
  /** Cutout mode accent (orange). */
  accent: string;
  /** Text/icon colour to put on top of `accent`. */
  onAccent: string;
  /** Reserved for the future Scan mode. */
  accentScan: string;
  onAccentScan: string;
  danger: string;
  checkerboardA: string;
  checkerboardB: string;
  overlay: string;
}

export const darkTokens: ThemeTokens = {
  scheme: 'dark',
  background: '#0E1116',
  surface: '#171C23',
  surfaceRaised: '#202732',
  border: '#343D4A',
  borderStrong: '#6B7686',
  text: '#F4F6F8',
  textMuted: '#A6AFBC',
  accent: '#FF8A3D',
  onAccent: '#0E1116',
  accentScan: '#2DD4BF',
  onAccentScan: '#0E1116',
  danger: '#FF7A7A',
  checkerboardA: '#2B313B',
  checkerboardB: '#1B2027',
  overlay: 'rgba(0,0,0,0.62)',
};

export const lightTokens: ThemeTokens = {
  scheme: 'light',
  background: '#FAF7F2',
  surface: '#FFFFFF',
  surfaceRaised: '#F1ECE3',
  border: '#CFC6B8',
  borderStrong: '#85806F',
  text: '#1C1A17',
  textMuted: '#5B564C',
  accent: '#B84A06',
  onAccent: '#FFFFFF',
  accentScan: '#0B7A6E',
  onAccentScan: '#FFFFFF',
  danger: '#B3261E',
  checkerboardA: '#E4DED3',
  checkerboardB: '#F8F5EF',
  overlay: 'rgba(20,16,10,0.45)',
};

export const tokensFor = (scheme: ThemeScheme): ThemeTokens =>
  scheme === 'dark' ? darkTokens : lightTokens;

export function resolveScheme(
  mode: ThemeMode,
  system: ThemeScheme | null | undefined,
): ThemeScheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'light' ? 'light' : 'dark';
}

export const radii = { sm: 8, md: 14, lg: 22, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const fontSizes = { caption: 12, body: 15, bodyLg: 17, title: 22, display: 30 } as const;
/** System sans is used for the UI (no custom font bundled); mono is for future text results. */
export const fonts = {
  sans: undefined as string | undefined,
  mono: 'monospace',
} as const;
