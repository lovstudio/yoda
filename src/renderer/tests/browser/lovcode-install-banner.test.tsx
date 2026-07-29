import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LovcodeInstallBanner } from '@renderer/features/command-palette/lovcode-install-banner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: mocks.openExternal } },
}));

describe('LovcodeInstallBanner', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('acknowledges an installed desktop app without offering another download', async () => {
    await act(async () =>
      root.render(createElement(LovcodeInstallBanner, { desktopInstalled: true }))
    );

    expect(host.textContent).toContain('commandPalette.lovcode.desktopOnlyTitle');
    expect(host.textContent).toContain('commandPalette.lovcode.desktopOnlyDescription');
    expect(host.querySelector('button')).toBeNull();
  });
});
