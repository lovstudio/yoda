import { createContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Theme } from '@shared/app-settings';
import {
  findCustomTheme,
  YODA_GREEN_THEME,
  YODA_LIGHT2_THEME,
  YODA_WARM_THEME,
} from '@shared/custom-theme';
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

/** Built-in themes that ship as custom-theme overlays over the base classes. */
function findBuiltInOverlay(selection: Theme) {
  switch (selection) {
    case 'ywarm':
      return YODA_WARM_THEME;
    case 'ygreen':
      return YODA_GREEN_THEME;
    case 'ylight2':
      return YODA_LIGHT2_THEME;
    default:
      return undefined;
  }
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
  const { value: systemThemesValue, isLoading: systemThemesLoading } =
    useAppSettingsKey('systemThemes');
  const [, setCachedTheme] = useLocalStorage<Theme>('yoda-theme', null);

  // OS appearance, kept reactive so follow-system re-resolves on change.
  const [systemMode, setSystemMode] = useState<EffectiveTheme>(getSystemTheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemMode(mq.matches ? 'ydark' : 'ylight');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const theme: Theme = themeValue ?? null;
  const customThemes = customThemesValue?.items ?? [];
  const systemThemes = systemThemesValue ?? { light: 'ylight' as const, dark: 'ydark' as const };

  // null = follow system: resolve through the configured light/dark pair.
  const activeSelection: Theme =
    theme ?? (systemMode === 'ydark' ? systemThemes.dark : systemThemes.light);

  const selectedCustomTheme =
    findBuiltInOverlay(activeSelection) ?? findCustomTheme(customThemes, activeSelection);
  const effectiveTheme: EffectiveTheme = selectedCustomTheme
    ? selectedCustomTheme.mode === 'dark'
      ? 'ydark'
      : 'ylight'
    : activeSelection === 'ylight' || activeSelection === 'ydark'
      ? activeSelection
      : systemMode;
  const themeFingerprint = getCustomThemeFingerprint(selectedCustomTheme);
  const isThemeLoading = isLoading || customThemesLoading || systemThemesLoading;

  useLayoutEffect(() => {
    if (isThemeLoading) return;
    applyTheme(effectiveTheme, selectedCustomTheme);
  }, [effectiveTheme, selectedCustomTheme, isThemeLoading]);

  useEffect(() => {
    if (isThemeLoading) return;
    setCachedTheme(theme);
  }, [theme, isThemeLoading, setCachedTheme]);

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
