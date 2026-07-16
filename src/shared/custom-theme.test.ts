import { describe, expect, it } from 'vitest';
import {
  createCustomThemeCollection,
  createDreamSkinTheme,
  CUSTOM_THEME_EXAMPLE,
  CUSTOM_THEME_EXAMPLE_FILE_NAME,
  getCustomThemeId,
  parseCustomThemePackageText,
  resolveThemeMode,
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
    expect(result.themes).toEqual([{ theme: validTheme, warnings: [] }]);
  });

  it('keeps the downloadable example importable', () => {
    const result = parseCustomThemePackageText(JSON.stringify(CUSTOM_THEME_EXAMPLE));

    expect(CUSTOM_THEME_EXAMPLE_FILE_NAME).toBe('yoda-theme-example.json');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.themes[0]?.theme.id).toBe(CUSTOM_THEME_EXAMPLE.id);
    expect(result.themes[0]?.warnings).toEqual([]);
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
    expect(result.themes[0]?.theme.colors.background).toBe('#faf7ef');
  });

  it('round-trips a collection of themes', () => {
    const secondTheme = {
      ...validTheme,
      id: 'solar-dark',
      name: 'Solar Dark',
      mode: 'dark' as const,
    };
    const result = parseCustomThemePackageText(
      JSON.stringify(createCustomThemeCollection([validTheme, secondTheme]))
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.themes.map(({ theme }) => theme.id)).toEqual(['solar-light', 'solar-dark']);
  });

  it('rejects duplicate themes inside a collection', () => {
    const result = parseCustomThemePackageText(
      JSON.stringify(createCustomThemeCollection([validTheme, validTheme]))
    );

    expect(result).toMatchObject({ ok: false, reason: 'invalid-theme' });
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
    expect(result.themes[0]?.warnings).toEqual(
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

  it('resolves the Dream Skin preset as a light theme', () => {
    expect(
      resolveThemeMode('ydream', {
        systemMode: 'dark',
        systemThemes: { light: 'ylight', dark: 'ydark' },
        customThemes: [],
      })
    ).toBe('light');
  });

  it('creates an importable image-backed Dream Skin', () => {
    const skin = createDreamSkinTheme({
      id: 'dream-ocean',
      name: 'Ocean Dream',
      image: 'data:image/png;base64,aA==',
      imageName: 'ocean.png',
    });
    const parsed = parseCustomThemePackageText(JSON.stringify(skin));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.themes[0]?.theme.skin).toMatchObject({
      kind: 'dream-skin',
      imageName: 'ocean.png',
    });
  });

  it('rejects executable skin image URLs', () => {
    const parsed = parseCustomThemePackageText(
      JSON.stringify({
        ...validTheme,
        skin: {
          kind: 'dream-skin',
          image: 'javascript:alert(1)',
          imageName: 'unsafe.png',
        },
      })
    );

    expect(parsed).toMatchObject({ ok: false, reason: 'invalid-theme' });
  });

  it('resolves the bundled night skin as dark', () => {
    expect(
      resolveThemeMode('ydream-night', {
        systemMode: 'light',
        systemThemes: { light: 'ylight', dark: 'ydark' },
        customThemes: [],
      })
    ).toBe('dark');
  });
});
