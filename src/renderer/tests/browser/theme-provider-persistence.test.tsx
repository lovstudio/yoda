import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Theme } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useLocalStorage } from '@renderer/lib/hooks/useLocalStorage';
import { ThemeProvider } from '@renderer/lib/providers/theme-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@renderer/lib/pty/pty', () => ({ applyThemeToAll: vi.fn() }));
vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: vi.fn(),
}));
vi.mock('@renderer/lib/hooks/useLocalStorage', () => ({
  useLocalStorage: vi.fn(),
}));

const useAppSettingsKeyMock = vi.mocked(useAppSettingsKey);
const useLocalStorageMock = vi.mocked(useLocalStorage);

/** The generic is erased on the mock, so the tuple needs one cast to land. */
function stubCache(cached: Theme, setter: (value: Theme) => void) {
  useLocalStorageMock.mockReturnValue([cached, setter] as unknown as ReturnType<
    typeof useLocalStorage
  >);
}

/** Only `theme` is unresolved; a real slow boot leaves the sibling keys fine. */
function stubSettings(themeValue: Theme | undefined) {
  useAppSettingsKeyMock.mockImplementation(((key: string) => {
    if (key === 'theme') {
      return { value: themeValue, isLoading: false, update: vi.fn() };
    }
    if (key === 'customThemes') {
      return { value: { items: [] }, isLoading: false, update: vi.fn() };
    }
    return { value: { light: 'ylight', dark: 'ydark' }, isLoading: false, update: vi.fn() };
  }) as unknown as typeof useAppSettingsKey);
}

describe('ThemeProvider persistence', () => {
  let host: HTMLDivElement;
  let root: Root;
  let setCachedTheme: ReturnType<typeof vi.fn<(value: Theme) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    setCachedTheme = vi.fn<(value: Theme) => void>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    const html = document.documentElement;
    html.classList.remove('ylight', 'ydark', 'ydream');
    html.removeAttribute('style');
    html.removeAttribute('data-dream-shell');
  });

  it('keeps the cached skin while the persisted theme is still unresolved', async () => {
    stubCache('ydream-panther', setCachedTheme);
    stubSettings(undefined);

    await render();

    expect(document.documentElement.classList.contains('ydream')).toBe(true);
    // Nothing authoritative arrived, so the pre-paint cache must stay untouched.
    expect(setCachedTheme).not.toHaveBeenCalled();
  });

  it('adopts and caches the persisted theme once it resolves', async () => {
    stubCache('ydream-panther', setCachedTheme);
    stubSettings('ydark');

    await render();

    expect(document.documentElement.classList.contains('ydark')).toBe(true);
    expect(document.documentElement.classList.contains('ydream')).toBe(false);
    expect(setCachedTheme).toHaveBeenCalledWith('ydark');
  });

  it('caches an explicit follow-system choice', async () => {
    stubCache('ydream-panther', setCachedTheme);
    stubSettings(null);

    await render();

    expect(setCachedTheme).toHaveBeenCalledWith(null);
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(ThemeProvider, null, null));
    });
  }
});
