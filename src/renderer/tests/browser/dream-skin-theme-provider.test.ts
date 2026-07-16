import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDreamSkinTheme,
  DREAM_SKIN_BUILTIN_IMAGES,
  YODA_DREAM_ARINA_THEME,
  YODA_DREAM_GOLD_THEME,
  YODA_DREAM_THEME,
} from '@shared/custom-theme';
import { dreamSkinBackgroundImage } from '@renderer/lib/providers/dream-skin-assets';
import { applyThemeToDocument } from '@renderer/lib/providers/theme-provider';

vi.mock('@renderer/lib/pty/pty', () => ({ applyThemeToAll: vi.fn() }));
vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: vi.fn(),
}));
vi.mock('@renderer/lib/hooks/useLocalStorage', () => ({
  useLocalStorage: vi.fn(),
}));

const DREAM_VARIABLES = [
  '--dream-skin-art',
  '--dream-skin-brand',
  '--dream-skin-subtitle',
  '--dream-skin-tagline',
  '--dream-skin-status',
  '--dream-skin-quote',
] as const;

afterEach(() => {
  const root = document.documentElement;
  root.classList.remove('ylight', 'ydark', 'ydream');
  root.removeAttribute('data-dream-shell');
  root.removeAttribute('style');
});

describe('Dream Skin document theme', () => {
  it('produces valid CSS preview backgrounds for every bundled asset', () => {
    for (const image of DREAM_SKIN_BUILTIN_IMAGES) {
      const backgroundImage = dreamSkinBackgroundImage(image);
      const preview = document.createElement('span');

      preview.style.backgroundImage = backgroundImage;

      expect(CSS.supports('background-image', backgroundImage), image).toBe(true);
      expect(preview.style.backgroundImage, image).not.toBe('');
    }
  });

  it('uses the original floral gallery artwork for the default light skin', () => {
    applyThemeToDocument('ylight', YODA_DREAM_THEME);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--dream-skin-art')).toContain('dream-bloom.svg');
    expect(root.style.getPropertyValue('--dream-skin-subtitle')).toContain('YODA DREAM SKIN');
  });

  it('applies the Arina Hashimoto custom branding and floral artwork', () => {
    applyThemeToDocument('ylight', YODA_DREAM_ARINA_THEME);

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--dream-skin-art')).toContain('dream-bloom.svg');
    expect(root.style.getPropertyValue('--dream-skin-brand')).toContain('桥本有菜专属定制');
    expect(root.style.getPropertyValue('--dream-skin-subtitle')).toContain('桥本有菜 专属定制皮肤');
    expect(root.style.getPropertyValue('--dream-skin-status')).toContain('ARINA CUSTOM ONLINE');
  });

  it('resolves a bundled gallery skin to its packaged artwork', () => {
    applyThemeToDocument('ydark', YODA_DREAM_GOLD_THEME);

    const root = document.documentElement;
    expect(root.dataset.dreamShell).toBe('dark');
    expect(root.style.getPropertyValue('--dream-skin-art')).toContain('data:image/svg+xml');
    expect(root.style.getPropertyValue('--dream-skin-brand')).toContain('Stage Black Gold');
  });

  it('applies an image-backed skin and removes it when another theme is selected', () => {
    const theme = createDreamSkinTheme({
      id: 'dream-browser',
      name: 'Browser Dream',
      image: 'data:image/png;base64,aA==',
      imageName: 'browser.png',
    });

    applyThemeToDocument('ylight', theme);

    const root = document.documentElement;
    expect(root.classList.contains('ylight')).toBe(true);
    expect(root.classList.contains('ydream')).toBe(true);
    expect(root.dataset.dreamShell).toBe('light');
    expect(root.style.getPropertyValue('--dream-skin-art')).toContain('data:image/png;base64,aA==');
    expect(root.style.getPropertyValue('--dream-skin-brand')).toContain('Browser Dream');
    expect(root.style.getPropertyValue('--background')).toMatch(/^rgba\(/);

    applyThemeToDocument('ydark');

    expect(root.classList.contains('ydream')).toBe(false);
    expect(root.dataset.dreamShell).toBeUndefined();
    for (const variable of DREAM_VARIABLES) {
      expect(root.style.getPropertyValue(variable)).toBe('');
    }
  });
});
