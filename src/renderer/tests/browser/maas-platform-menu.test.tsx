import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  showZenmuxUsage: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/maas/useMaas', () => ({
  useConnectMaasPlatform: () => ({ isPending: false, mutate: vi.fn() }),
  useDisconnectMaasPlatform: () => ({ isPending: false, mutate: vi.fn() }),
  useMaasConnections: () => ({ data: [], isLoading: false }),
  useMaasGlobalBinding: () => ({ data: { enabled: false }, isLoading: false }),
  useMaasPlatformDescriptions: () => ({ data: [] }),
  useSetMaasGlobalBinding: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: vi.fn(async () => {}) } },
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => mocks.showZenmuxUsage,
}));

describe('MaaS platform menu', () => {
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
    document
      .querySelectorAll('[data-slot="dropdown-menu-content"]')
      .forEach((node) => node.remove());
    host.remove();
  });

  it('opens the add-platform menu with its label inside a Base UI menu group', async () => {
    const { MaasView } = await import('@renderer/features/maas/components/MaasView');
    await act(async () => root.render(createElement(MaasView, { embedded: true })));

    const addButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'maas.addPlatform'
    );
    expect(addButton).toBeDefined();

    await act(async () => addButton?.click());

    const menu = document.querySelector('[data-slot="dropdown-menu-content"]');
    expect(menu?.textContent).toContain('maas.selectPlatform');
    expect(menu?.textContent).toContain('ZenMux');
  });
});
