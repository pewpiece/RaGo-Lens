import { contrastRatio } from '@/theme/contrast';
import {
  darkTokens,
  lightTokens,
  resolveScheme,
  tokensFor,
  type ThemeTokens,
} from '@/theme/tokens';

const sets: [string, ThemeTokens][] = [
  ['dark', darkTokens],
  ['light', lightTokens],
];

describe.each(sets)('%s tokens', (_name, t) => {
  it('defines every token as a colour string', () => {
    const required: (keyof ThemeTokens)[] = [
      'background',
      'surface',
      'surfaceRaised',
      'border',
      'text',
      'textMuted',
      'accent',
      'danger',
      'checkerboardA',
      'checkerboardB',
      'overlay',
    ];
    for (const k of required) expect(typeof t[k]).toBe('string');
    expect(t.accentScan).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('meets WCAG AA (4.5:1) for body text on every surface', () => {
    for (const bg of [t.background, t.surface, t.surfaceRaised]) {
      expect(contrastRatio(t.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('meets AA for text on accent fills and accent/danger text on the background', () => {
    expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.onAccentScan, t.accentScan)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.accent, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.accent, t.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.danger, t.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.danger, t.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('meets the 3:1 non-text UI minimum for control outlines on every surface', () => {
    for (const bg of [t.background, t.surface, t.surfaceRaised]) {
      expect(contrastRatio(t.borderStrong, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps card hairlines visible but decorative', () => {
    expect(contrastRatio(t.border, t.background)).toBeGreaterThanOrEqual(1.5);
  });

  it('keeps the two checkerboard greys distinguishable but subtle', () => {
    const r = contrastRatio(t.checkerboardA, t.checkerboardB);
    expect(r).toBeGreaterThan(1.1);
    expect(r).toBeLessThan(2);
  });
});

describe('scheme resolution', () => {
  it('honours explicit light/dark regardless of the system', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
  it('follows the system in system mode, defaulting to dark when unknown', () => {
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('dark');
  });
  it('maps schemes to token sets', () => {
    expect(tokensFor('light')).toBe(lightTokens);
    expect(tokensFor('dark')).toBe(darkTokens);
  });
});
