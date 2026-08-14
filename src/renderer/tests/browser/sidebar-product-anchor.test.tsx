import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_NAME } from '@shared/app-identity';
import type * as SidebarHelpMenuModule from '@renderer/features/sidebar/sidebar-help-menu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: { app: { openExternal: vi.fn() } },
}));

vi.mock('@renderer/lib/layout/navigation-provider', () => ({
  useNavigate: () => ({ navigate: vi.fn() }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    update: {
      currentVersion: '0.19.1',
      availableVersion: null,
      hasUpdate: false,
      state: { status: 'idle' },
      check: vi.fn(),
    },
  },
}));

describe('SidebarHelpMenu product anchor', () => {
  let host: HTMLDivElement;
  let root: Root;
  let SidebarHelpMenu: typeof SidebarHelpMenuModule.SidebarHelpMenu;

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    ({ SidebarHelpMenu } = await import('@renderer/features/sidebar/sidebar-help-menu'));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the parenthesized version beside the product name', async () => {
    await act(async () => root.render(createElement(SidebarHelpMenu, { showProductInfo: true })));

    const label = host.querySelector<HTMLElement>('[data-sidebar-product-label]');
    expect(label?.children[0]?.textContent).toBe(PRODUCT_NAME);
    expect(label?.children[1]?.textContent).toBe('(V0.19.1)');
    expect(label?.className).toContain('gap-1');
    expect(host.querySelector('[data-sidebar-product-logo]')?.className).toContain('size-6');
  });

  it('does not shrink the product logo in account-information mode', async () => {
    await act(async () => root.render(createElement(SidebarHelpMenu)));

    const logo = host.querySelector<HTMLElement>('[data-sidebar-product-logo]');
    expect(logo?.className).toContain('size-6');
    expect(logo?.className).not.toContain('size-4');
    expect(host.querySelector('[data-sidebar-product-label]')).toBeNull();
  });
});
