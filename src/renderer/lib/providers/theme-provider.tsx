import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Theme } from '@shared/app-settings';
import {
  BUILT_IN_DREAM_SKIN_THEMES,
  findCustomTheme,
  resolveThemeMode,
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
import { dreamSkinBackgroundImage } from './dream-skin-assets';

type EffectiveTheme = 'ylight' | 'ydark';

const DREAM_SKIN_CSS_VARIABLES = [
  '--dream-skin-art',
  '--dream-skin-brand',
  '--dream-skin-subtitle',
  '--dream-skin-tagline',
  '--dream-skin-status',
  '--dream-skin-quote',
  '--dream-skin-position-x',
  '--dream-skin-position-y',
  '--dream-skin-zoom',
  '--dream-skin-overlay',
  '--dream-skin-overlay-strong',
  '--dream-skin-overlay-weak',
  '--dream-skin-overlay-dark-strong',
  '--dream-skin-overlay-dark-weak',
  '--dream-skin-blur',
  '--dream-skin-art-opacity',
  '--dream-skin-workspace-opacity',
  '--dream-skin-decoration-density',
  '--dream-skin-decoration-opacity',
] as const;

function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined') return 'ylight';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ydark' : 'ylight';
}

/** Built-in themes that ship as custom-theme overlays over the base classes. */
function findBuiltInOverlay(selection: Theme) {
  if (selection && selection in BUILT_IN_DREAM_SKIN_THEMES) {
    return BUILT_IN_DREAM_SKIN_THEMES[selection as keyof typeof BUILT_IN_DREAM_SKIN_THEMES];
  }
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
    root.style.setProperty('--dream-skin-art', dreamSkinBackgroundImage(dreamSkin.image));
    root.style.setProperty('--dream-skin-brand', JSON.stringify(customTheme.name));
    root.style.setProperty('--dream-skin-subtitle', JSON.stringify(dreamSkin.brandSubtitle));
    root.style.setProperty('--dream-skin-tagline', JSON.stringify(dreamSkin.tagline));
    root.style.setProperty('--dream-skin-status', JSON.stringify(dreamSkin.statusText));
    root.style.setProperty('--dream-skin-quote', JSON.stringify(dreamSkin.quote));
    root.style.setProperty('--dream-skin-position-x', `${dreamSkin.imageTreatment.positionX}%`);
    root.style.setProperty('--dream-skin-position-y', `${dreamSkin.imageTreatment.positionY}%`);
    root.style.setProperty('--dream-skin-zoom', String(dreamSkin.imageTreatment.zoom));
    root.style.setProperty(
      '--dream-skin-overlay',
      String(dreamSkin.imageTreatment.overlayStrength)
    );
    root.style.setProperty(
      '--dream-skin-overlay-strong',
      `${70 + dreamSkin.imageTreatment.overlayStrength * 30}%`
    );
    root.style.setProperty(
      '--dream-skin-overlay-weak',
      `${44 + dreamSkin.imageTreatment.overlayStrength * 42}%`
    );
    root.style.setProperty(
      '--dream-skin-overlay-dark-strong',
      `${76 + dreamSkin.imageTreatment.overlayStrength * 24}%`
    );
    root.style.setProperty(
      '--dream-skin-overlay-dark-weak',
      `${50 + dreamSkin.imageTreatment.overlayStrength * 38}%`
    );
    root.style.setProperty('--dream-skin-blur', `${dreamSkin.imageTreatment.blur}px`);
    root.style.setProperty('--dream-skin-art-opacity', String(dreamSkin.imageTreatment.artOpacity));
    root.style.setProperty(
      '--dream-skin-workspace-opacity',
      String(dreamSkin.imageTreatment.artOpacity * 0.17)
    );
    root.style.setProperty(
      '--dream-skin-decoration-density',
      String(dreamSkin.decorations.density)
    );
    root.style.setProperty(
      '--dream-skin-decoration-opacity',
      String(0.16 + dreamSkin.decorations.density * 0.58)
    );
    root.dataset.dreamDecoration = dreamSkin.decorations.preset;
    root.dataset.dreamMotion = dreamSkin.decorations.motion ? 'on' : 'off';
    root.dataset.dreamTypography = dreamSkin.typography;
    root.dataset.dreamTextSide = dreamSkin.imageTreatment.textSide;
    root.dataset.dreamExtend = dreamSkin.imageTreatment.extendToWorkspace ? 'on' : 'off';
    root.dataset.dreamOverlayCopy = dreamSkin.imageTreatment.showOverlayCopy ? 'on' : 'off';
  } else {
    root.removeAttribute('data-dream-shell');
    root.removeAttribute('data-dream-decoration');
    root.removeAttribute('data-dream-motion');
    root.removeAttribute('data-dream-typography');
    root.removeAttribute('data-dream-text-side');
    root.removeAttribute('data-dream-extend');
    root.removeAttribute('data-dream-overlay-copy');
    for (const variable of DREAM_SKIN_CSS_VARIABLES) {
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
  const themeFingerprint = useMemo(
    () => getCustomThemeFingerprint(selectedCustomTheme),
    [selectedCustomTheme]
  );
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

  const setTheme = useCallback(
    (newTheme: Theme) => {
      update(newTheme);
    },
    [update]
  );

  const toggleTheme = useCallback(() => {
    const next = effectiveTheme === 'ylight' ? 'ydark' : 'ylight';
    setTheme(next);
  }, [effectiveTheme, setTheme]);

  const contextValue = useMemo(
    () => ({ theme, setTheme, toggleTheme, effectiveTheme, themeFingerprint }),
    [effectiveTheme, setTheme, theme, themeFingerprint, toggleTheme]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}
