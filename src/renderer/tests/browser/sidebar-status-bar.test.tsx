import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  primary: undefined as 'product' | 'account' | undefined,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: mocks.primary === undefined ? undefined : { sidebarStatusBarPrimary: mocks.primary },
  }),
}));

vi.mock('@renderer/features/sidebar/sidebar-account-anchor', () => ({
  SidebarAccountAnchor: ({ compact = false }: { compact?: boolean }) =>
    createElement('div', { 'data-testid': 'account', 'data-compact': String(compact) }),
}));

vi.mock('@renderer/features/sidebar/sidebar-help-menu', () => ({
  SidebarHelpMenu: ({ showProductInfo = false }: { showProductInfo?: boolean }) =>
    createElement('div', {
      'data-testid': 'product',
      'data-primary': String(showProductInfo),
    }),
}));

describe('SidebarStatusBar', () => {
  let host: HTMLDivElement;
  let root: Root;
  let SidebarStatusBar: () => ReactNode;

  beforeEach(async () => {
    mocks.primary = undefined;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    ({ SidebarStatusBar } = await import('@renderer/features/sidebar/sidebar-status-bar'));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('shows product information first when the setting is missing', async () => {
    await act(async () => root.render(createElement(SidebarStatusBar)));

    const footer = host.querySelector('footer');
    expect(footer?.dataset.sidebarStatusPrimary).toBe('product');
    expect(footer?.firstElementChild?.getAttribute('data-testid')).toBe('product');
    expect(host.querySelector('[data-testid="product"]')?.getAttribute('data-primary')).toBe(
      'true'
    );
    expect(host.querySelector('[data-testid="account"]')?.getAttribute('data-compact')).toBe(
      'true'
    );
  });

  it('promotes account information when configured', async () => {
    mocks.primary = 'account';
    await act(async () => root.render(createElement(SidebarStatusBar)));

    const footer = host.querySelector('footer');
    expect(footer?.dataset.sidebarStatusPrimary).toBe('account');
    expect(footer?.firstElementChild?.getAttribute('data-testid')).toBe('account');
    expect(host.querySelector('[data-testid="account"]')?.getAttribute('data-compact')).toBe(
      'false'
    );
    expect(host.querySelector('[data-testid="product"]')?.getAttribute('data-primary')).toBe(
      'false'
    );
  });
});
