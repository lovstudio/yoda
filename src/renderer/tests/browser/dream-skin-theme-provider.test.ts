import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDreamSkinTheme } from '@shared/custom-theme';
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
