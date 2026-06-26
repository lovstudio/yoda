import { nativeTheme } from 'electron';
import { resolveThemeMode, type CustomThemeMode } from '@shared/custom-theme';
import { appSettingsService } from './settings-service';

/**
 * Resolves the effective light/dark mode of Yoda's embedded terminal in the
 * main process — mirrors the renderer's ThemeProvider but reads OS appearance
 * via Electron's `nativeTheme` instead of `matchMedia`. Used to align agent CLI
 * themes (e.g. Claude's `--settings theme`) with the terminal background.
 */
export async function resolveTerminalThemeMode(): Promise<CustomThemeMode> {
  const [theme, systemThemes, customThemes] = await Promise.all([
    appSettingsService.get('theme'),
    appSettingsService.get('systemThemes'),
    appSettingsService.get('customThemes'),
  ]);
  // `nativeTheme` is unavailable outside an Electron main process (e.g. vitest);
  // fall back to dark, the conventional CLI default. Only matters for follow-system.
  const systemMode = (nativeTheme?.shouldUseDarkColors ?? true) ? 'dark' : 'light';
  return resolveThemeMode(theme, {
    systemMode,
    systemThemes,
    customThemes: customThemes.items,
  });
}
