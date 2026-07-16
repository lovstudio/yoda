import { describe, expect, it } from 'vitest';
import { createDreamSkinTheme, CUSTOM_THEME_EXAMPLE } from '@shared/custom-theme';
import { buildCustomThemeCssVars } from './custom-theme-css';

describe('custom theme CSS variables', () => {
  it('keeps light sidebar active rows distinct from the sidebar background', () => {
    const vars = buildCustomThemeCssVars(CUSTOM_THEME_EXAMPLE);

    expect(vars['--background-tertiary']).not.toBe(vars['--background-tertiary-2']);
    expect(vars['--background-tertiary-1']).not.toBe(vars['--background-tertiary-2']);
    expect(vars['--background-tertiary-2']).toBe(CUSTOM_THEME_EXAMPLE.colors.background3);
  });

  it('makes app surfaces translucent while keeping terminal and Monaco opaque for skins', () => {
    const theme = createDreamSkinTheme({
      id: 'dream-test',
      name: 'Dream Test',
      image: 'data:image/png;base64,aA==',
      imageName: 'test.png',
    });
    const vars = buildCustomThemeCssVars(theme);

    expect(vars['--background']).toMatch(/^rgba\(/);
    expect(vars['--background-tertiary']).toMatch(/^rgba\(/);
    expect(vars['--xterm-bg']).toBe(theme.colors.background);
    expect(vars['--monaco-bg']).toBe(theme.colors.background);
  });

  it('uses the composition overlay setting to control IDE panel opacity', () => {
    const soft = createDreamSkinTheme({
      id: 'dream-soft',
      name: 'Dream Soft',
      image: 'data:image/png;base64,aA==',
      imageName: 'soft.png',
      skin: { imageTreatment: { overlayStrength: 0.1 } },
    });
    const strong = createDreamSkinTheme({
      id: 'dream-strong',
      name: 'Dream Strong',
      image: 'data:image/png;base64,aA==',
      imageName: 'strong.png',
      skin: { imageTreatment: { overlayStrength: 0.8 } },
    });

    const softAlpha = Number(
      buildCustomThemeCssVars(soft)['--background']?.match(/, ([\d.]+)\)$/)?.[1]
    );
    const strongAlpha = Number(
      buildCustomThemeCssVars(strong)['--background']?.match(/, ([\d.]+)\)$/)?.[1]
    );
    expect(strongAlpha).toBeGreaterThan(softAlpha);
  });
});
