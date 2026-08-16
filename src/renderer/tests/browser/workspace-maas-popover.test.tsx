import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as ReactI18nextModule from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const selectorProps = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactI18nextModule>()),
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.more': 'More',
        'workspaceRuntime.maas.title': 'Model access',
        'workspaceRuntime.maas.description': 'Global routing for compatible Agent CLIs',
        'workspaceRuntime.maas.profile': 'Profile',
        'workspaceRuntime.maas.manageAccount': 'Manage model access',
        'workspaceRuntime.maas.openLogs': 'Open AI logs',
        'workspaceRuntime.maas.effective': 'Active',
        'workspaceRuntime.maas.needsAttention': 'Check setup',
        'workspaceRuntime.maas.disabled': 'Disabled',
      })[key] ?? key,
  }),
}));

vi.mock('@renderer/features/maas/components/MaasGlobalSelector', () => ({
  MaasGlobalSelector: (props: { showSelectedStatus?: boolean }) => {
    selectorProps(props);
    return createElement(
      'button',
      { type: 'button', 'data-testid': 'profile-selector' },
      'LovBrowser'
    );
  },
}));

describe('WorkspaceMaasPopover', () => {
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

  it('keeps the section to Profile selection and moves both actions into the overflow menu', async () => {
    const onManage = vi.fn();
    const onOpenLogs = vi.fn();
    const { WorkspaceMaasPopover } = await import('@renderer/app/workspace-maas-popover');
    await act(async () =>
      root.render(
        createElement(WorkspaceMaasPopover, {
          binding: {
            platformId: 'custom:first',
            enabled: true,
            effective: true,
            runtimeIds: ['codex'],
          },
          onManage,
          onOpenLogs,
        })
      )
    );

    expect(selectorProps).toHaveBeenCalledWith({ showSelectedStatus: false });
    expect(host.textContent?.match(/Active/g)).toHaveLength(1);
    expect(host.textContent).toContain('Global routing for compatible Agent CLIs');
    // Both actions live behind the overflow menu — nothing duplicates them inline.
    expect(host.textContent).not.toContain('Manage model access');
    expect(host.textContent).not.toContain('Open AI logs');

    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="More"]')!);
    const menuItem = (label: string) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')).find(
        (item) => item.textContent?.includes(label)
      );
    expect(menuItem('Manage model access')).toBeTruthy();
    await userEvent.click(menuItem('Manage model access')!);
    expect(onManage).toHaveBeenCalledOnce();

    await userEvent.click(host.querySelector<HTMLButtonElement>('[aria-label="More"]')!);
    await userEvent.click(menuItem('Open AI logs')!);
    expect(onOpenLogs).toHaveBeenCalledOnce();
  });
});
