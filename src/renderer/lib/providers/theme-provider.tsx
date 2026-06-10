import { createContext, useEffect, useLayoutEffect, type ReactNode } from 'react';
import type { Theme } from '@shared/app-settings';
import { findCustomTheme, YODA_WARM_THEME } from '@shared/custom-theme';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import { applyThemeToAll } from '@renderer/lib/pty/pty';
import {
  buildCustomThemeCssVars,
  CUSTOM_THEME_CSS_VARIABLES,
  getCustomThemeFingerprint,
} from './custom-theme-css';

type EffectiveTheme = 'ylight' | 'ydark';

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'ylight';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ydark' : 'ylight';
}

function applyTheme(effective: EffectiveTheme, customTheme?: ReturnType<typeof findCustomTheme>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('ylight', 'ydark', 'emlight', 'emdark');
  root.classList.add(effective);

  for (const variable of CUSTOM_THEME_CSS_VARIABLES) {
    root.style.removeProperty(variable);
  }

  if (customTheme) {
    const vars = buildCustomThemeCssVars(customTheme);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
  }

  root.style.colorScheme = effective === 'ydark' ? 'dark' : 'light';
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
  themeFingerprint: string;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { value: themeValue, isLoading, update } = useAppSettingsKey('theme');
  const { value: customThemesValue, isLoading: customThemesLoading } =
    useAppSettingsKey('customThemes');
  const [, setCachedTheme] = useLocalStorage<Theme>('yoda-theme', null);

  const theme: Theme = themeValue ?? null;
  const customThemes = customThemesValue?.items ?? [];
  const selectedCustomTheme =
    theme === 'ywarm' ? YODA_WARM_THEME : findCustomTheme(customThemes, theme);
  const effectiveTheme: EffectiveTheme = selectedCustomTheme
    ? selectedCustomTheme.mode === 'dark'
      ? 'ydark'
      : 'ylight'
    : theme === 'ylight' || theme === 'ydark'
      ? theme
      : getSystemTheme();
  const themeFingerprint = getCustomThemeFingerprint(selectedCustomTheme);
  const isThemeLoading = isLoading || customThemesLoading;

  useLayoutEffect(() => {
    if (isThemeLoading) return;
    applyTheme(effectiveTheme, selectedCustomTheme);
  }, [effectiveTheme, selectedCustomTheme, isThemeLoading]);

  useEffect(() => {
    if (isThemeLoading) return;
    setCachedTheme(theme);
  }, [theme, isThemeLoading, setCachedTheme]);

  // Subscribe to system color scheme changes when no explicit preference is set.
  useEffect(() => {
    if (theme !== null) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (isThemeLoading) return;
      const newEffective = mq.matches ? 'ydark' : 'ylight';
      applyTheme(newEffective);
      applyThemeToAll();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme, isThemeLoading]);

  // Re-apply xterm theme after CSS classes have been updated by the effect above.
  useEffect(() => {
    applyThemeToAll();
  }, [effectiveTheme, themeFingerprint]);

  const setTheme = (newTheme: Theme) => {
    update(newTheme);
  };

  const toggleTheme = () => {
    const next = effectiveTheme === 'ylight' ? 'ydark' : 'ylight';
    setTheme(next);
  };

  return (
    <ThemeContext.Provider
      value={{ theme, setTheme, toggleTheme, effectiveTheme, themeFingerprint }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
