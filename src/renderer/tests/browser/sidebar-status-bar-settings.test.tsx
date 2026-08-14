import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { sidebarStatusBarPrimary: 'product' },
    update: mocks.update,
    isLoading: false,
    isSaving: false,
    isFieldOverridden: () => false,
    resetField: vi.fn(),
  }),
}));

describe('SidebarStatusBarSettingsRow', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const { default: SidebarStatusBarSettingsRow } = await import(
      '@renderer/features/settings/components/SidebarStatusBarSettingsRow'
    );
    await act(async () => root.render(createElement(SidebarStatusBarSettingsRow)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-slot="select-content"]').forEach((node) => node.remove());
    host.remove();
  });

  it('defaults to product information and persists an account-information selection', async () => {
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="settings.interfaceTab.sidebarStatusBarPrimary"]'
    );
    expect(trigger?.textContent).toContain('settings.interfaceTab.sidebarStatusBarProduct');

    await userEvent.click(trigger!);
    const accountOption = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
    ).find((node) => node.textContent === 'settings.interfaceTab.sidebarStatusBarAccount');
    expect(accountOption).not.toBeUndefined();
    await userEvent.click(accountOption!);

    expect(mocks.update).toHaveBeenCalledWith({ sidebarStatusBarPrimary: 'account' });
  });
});
