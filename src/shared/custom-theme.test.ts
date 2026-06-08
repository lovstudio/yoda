import { describe, expect, it } from 'vitest';
import {
  createCustomThemeCollection,
  CUSTOM_THEME_EXAMPLE,
  CUSTOM_THEME_EXAMPLE_FILE_NAME,
  getCustomThemeId,
  parseCustomThemePackageText,
  toCustomThemeSelection,
  type CustomTheme,
} from './custom-theme';

const validTheme: CustomTheme = {
  schemaVersion: 1,
  id: 'solar-light',
  name: 'Solar Light',
  mode: 'light',
  colors: {
    background: '#faf7ef',
    background1: '#f2ecdd',
    background2: '#e8dfca',
    background3: '#d8ceb9',
    foreground: '#1f2933',
    foregroundMuted: '#64707d',
    foregroundPassive: '#9ca3af',
    border: '#d8ceb9',
    border1: '#b9ad95',
    border2: '#918771',
    primaryButtonBackground: '#215a46',
    primaryButtonBackgroundHover: '#287055',
    primaryButtonForeground: '#ffffff',
    primaryButtonBorder: '#1b4b3a',
    statusInProgress: '#9a6700',
    statusInReview: '#2f7d4f',
    statusDone: '#6b7280',
    statusTodo: '#6b7280',
    statusCancelled: '#9ca3af',
    diffAdded: '#3f8f5f',
    diffModified: '#b7791f',
    diffDeleted: '#c2413b',
  },
};

describe('custom theme packages', () => {
  it('parses a valid single theme package', () => {
    const result = parseCustomThemePackageText(JSON.stringify(validTheme));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.id).toBe('solar-light');
    expect(result.warnings).toEqual([]);
  });

  it('keeps the downloadable example importable', () => {
    const result = parseCustomThemePackageText(JSON.stringify(CUSTOM_THEME_EXAMPLE));

    expect(CUSTOM_THEME_EXAMPLE_FILE_NAME).toBe('yoda-theme-example.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.id).toBe(CUSTOM_THEME_EXAMPLE.id);
    expect(result.warnings).toEqual([]);
  });

  it('normalizes hex colors to lowercase', () => {
    const result = parseCustomThemePackageText(
      JSON.stringify({
        ...validTheme,
        colors: { ...validTheme.colors, background: '#FAF7EF' },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.theme.colors.background).toBe('#faf7ef');
  });

  it('rejects collection imports for v1', () => {
    const result = parseCustomThemePackageText(
      JSON.stringify(createCustomThemeCollection([validTheme]))
    );

    expect(result).toMatchObject({ ok: false, reason: 'collection-unsupported' });
  });

  it('warns instead of rejecting low contrast themes', () => {
    const result = parseCustomThemePackageText(
      JSON.stringify({
        ...validTheme,
        colors: {
          ...validTheme.colors,
          background: '#ffffff',
          foreground: '#ffffff',
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'low-contrast',
          foreground: 'foreground',
          background: 'background',
        }),
      ])
    );
  });

  it('round-trips custom theme selections', () => {
    const selection = toCustomThemeSelection('solar-light');

    expect(selection).toBe('custom:solar-light');
    expect(getCustomThemeId(selection)).toBe('solar-light');
    expect(getCustomThemeId('ylight')).toBeNull();
  });
});
