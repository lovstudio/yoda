import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceNotificationCenter } from '@renderer/app/workspace-notification-center';
import { workspaceNotificationStore } from '@renderer/lib/stores/notification-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; title?: string }) => {
      if (key === 'workspaceRuntime.notifications.triggerLabel') {
        return `Notifications ${options?.count ?? 0}`;
      }
      if (key === 'workspaceRuntime.notifications.openDetails') {
        return `Open ${options?.title ?? ''}`;
      }
      if (key === 'workspaceRuntime.notifications.delete') {
        return `Delete ${options?.title ?? ''}`;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

describe('WorkspaceNotificationCenter', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    workspaceNotificationStore.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-base-ui-portal]').forEach((portal) => portal.remove());
    host.remove();
    workspaceNotificationStore.clear();
  });

  it('opens details and lets the user delete an individual notification', async () => {
    const runAction = vi.fn();
    workspaceNotificationStore.enqueue(
      {
        title: 'Build finished',
        description: 'Desktop bundle is ready.',
        details: 'Build finished\n\nArtifact: release/Yoda.dmg',
        kind: 'success',
        source: 'toast',
      },
      undefined,
      { label: 'Open build', onClick: runAction }
    );
    workspaceNotificationStore.enqueue({
      title: 'Agent needs input',
      details: 'Session: SESSION_ID',
      kind: 'info',
      source: 'agent',
    });

    await act(async () => {
      root.render(
        createElement(WorkspaceNotificationCenter, {
          triggerClassName: 'trigger',
          triggerLabelClassName: 'label',
        })
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Notifications 2"]');
    await act(async () => trigger?.click());

    const openDetails = document.querySelector<HTMLButtonElement>(
      '[aria-label="Open Build finished"]'
    );
    expect(openDetails).not.toBeNull();
    await act(async () => openDetails?.click());

    expect(document.body.textContent).toContain('Artifact: release/Yoda.dmg');

    const actionButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Open build')
    );
    expect(actionButton).toBeDefined();
    await act(async () => actionButton?.click());
    expect(runAction).toHaveBeenCalledOnce();

    const deleteButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Delete Build finished"]'
    );
    await act(async () => deleteButton?.click());

    expect(workspaceNotificationStore.getSnapshot().map((entry) => entry.title)).toEqual([
      'Agent needs input',
    ]);
  });
});
