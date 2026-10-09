import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useThemeStore } from '@/store/instances';
import { resolveScheme, tokensFor, type ThemeMode, type ThemeTokens } from './tokens';

export interface ThemeValue {
  tokens: ThemeTokens;
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeValue>({ tokens: tokensFor('dark'), mode: 'system' });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.mode);
  const system = useColorScheme();
  const value = useMemo<ThemeValue>(
    () => ({ mode, tokens: tokensFor(resolveScheme(mode, system === 'light' ? 'light' : 'dark')) }),
    [mode, system],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Builds a memoised StyleSheet from the active tokens. */
export function useThemedStyles<T>(factory: (t: ThemeTokens) => T): T {
  const { tokens } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(tokens), [tokens]);
}
