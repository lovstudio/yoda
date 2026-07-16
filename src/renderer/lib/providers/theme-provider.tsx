import { createContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import dreamSkinArt from '@/assets/images/themes/codex-dream-skin.jpg';
import type { Theme } from '@shared/app-settings';
import {
  DREAM_SKIN_BUILTIN_IMAGE,
  findCustomTheme,
  resolveThemeMode,
  YODA_DREAM_NIGHT_THEME,
  YODA_DREAM_THEME,
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
    case 'ydream':
      return YODA_DREAM_THEME;
    case 'ydream-night':
      return YODA_DREAM_NIGHT_THEME;
    default:
      return undefined;
  }
}

export function applyThemeToDocument(
  effective: EffectiveTheme,
  customTheme?: ReturnType<typeof findCustomTheme>
) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('ylight', 'ydark', 'emlight', 'emdark', 'ydream');
  root.classList.add(effective);
  const dreamSkin = customTheme?.skin;
  if (dreamSkin) {
    root.classList.add('ydream');
    root.dataset.dreamShell = effective === 'ydark' ? 'dark' : 'light';
    const image = dreamSkin.image === DREAM_SKIN_BUILTIN_IMAGE ? dreamSkinArt : dreamSkin.image;
    root.style.setProperty('--dream-skin-art', `url(${JSON.stringify(image)})`);
    root.style.setProperty('--dream-skin-brand', JSON.stringify(customTheme.name));
    root.style.setProperty('--dream-skin-tagline', JSON.stringify(dreamSkin.tagline));
    root.style.setProperty('--dream-skin-status', JSON.stringify(dreamSkin.statusText));
    root.style.setProperty('--dream-skin-quote', JSON.stringify(dreamSkin.quote));
  } else {
    root.removeAttribute('data-dream-shell');
    for (const variable of [
      '--dream-skin-art',
      '--dream-skin-brand',
      '--dream-skin-tagline',
      '--dream-skin-status',
      '--dream-skin-quote',
    ]) {
      root.style.removeProperty(variable);
    }
  }

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
  const effectiveTheme: EffectiveTheme =
    resolveThemeMode(theme, {
      systemMode: systemMode === 'ydark' ? 'dark' : 'light',
      systemThemes,
      customThemes,
    }) === 'dark'
      ? 'ydark'
      : 'ylight';
  const themeFingerprint = getCustomThemeFingerprint(selectedCustomTheme);
  const isThemeLoading = isLoading || customThemesLoading || systemThemesLoading;

  useLayoutEffect(() => {
    if (isThemeLoading) return;
    applyThemeToDocument(effectiveTheme, selectedCustomTheme);
  }, [activeSelection, effectiveTheme, selectedCustomTheme, isThemeLoading]);

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
