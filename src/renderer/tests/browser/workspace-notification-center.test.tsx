import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { WorkspaceNotificationCenter } from '@renderer/app/workspace-notification-center';
import { workspaceNotificationStore } from '@renderer/lib/stores/notification-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  updateSettings: vi.fn(),
  retainedSources: {
    toast: true,
    agent: true,
    automation: true,
    system: true,
  } as Record<string, boolean>,
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { notificationCenterSources: mocks.retainedSources },
    update: mocks.updateSettings,
  }),
}));

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
      if (key === 'workspaceRuntime.notifications.moreActions') {
        return `More ${options?.title ?? ''}`;
      }
      if (key === 'workspaceRuntime.notifications.deleteAction') return 'Delete';
      if (key === 'workspaceRuntime.notifications.copy.idle') return 'Copy details';
      if (key === 'workspaceRuntime.notifications.copy.copied') return 'Details copied';
      if (key === 'common.copyDebugInfo') return 'Copy debug info';
      if (key === 'common.debugInfoCopied') return 'Debug info copied';
      if (key === 'common.copyFailed') return 'Copy failed';
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  copyTextToClipboard: mocks.copyTextToClipboard,
  useToast: () => ({
    toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
    },
  }),
}));

describe('WorkspaceNotificationCenter', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    workspaceNotificationStore.clear();
    mocks.retainedSources = { toast: true, agent: true, automation: true, system: true };
    workspaceNotificationStore.setRetainedSources({
      toast: true,
      agent: true,
      automation: true,
      system: true,
    });
    mocks.updateSettings.mockReset();
    mocks.copyTextToClipboard.mockReset();
    mocks.copyTextToClipboard.mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
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

  it('opens actionable details and removes an item after its action runs', async () => {
    const runAction = vi.fn();
    const openTarget = vi.fn();
    workspaceNotificationStore.enqueue(
      {
        title: 'Build finished',
        description: 'Desktop bundle is ready.',
        details: 'Build finished\n\nArtifact: release/Yoda.dmg',
        kind: 'success',
        source: 'toast',
        reason: 'action-required',
      },
      undefined,
      { label: 'Open build', onClick: runAction }
    );
    workspaceNotificationStore.enqueue({
      title: 'Agent needs input',
      details: 'Session: SESSION_ID',
      kind: 'info',
      source: 'agent',
      reason: 'action-required',
      target: { projectId: 'project-1', taskId: 'task-1', conversationId: 'session-1' },
    });

    await act(async () => {
      root.render(
        createElement(WorkspaceNotificationCenter, {
          triggerClassName: 'trigger',
          triggerLabelClassName: 'label',
          onOpenTarget: openTarget,
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
    expect(
      workspaceNotificationStore.getSnapshot().find((entry) => entry.title === 'Build finished')
        ?.readAt
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="Notifications 1"]')).not.toBeNull();

    const actionButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Open build')
    );
    expect(actionButton).toBeDefined();
    await act(async () => actionButton?.click());
    expect(runAction).toHaveBeenCalledOnce();
    expect(workspaceNotificationStore.getSnapshot().map((entry) => entry.title)).toEqual([
      'Agent needs input',
    ]);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    });

    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Notifications 1"]')?.click()
    );
    const overflowTrigger = document.querySelector<HTMLButtonElement>('[aria-label="common.more"]');
    expect(overflowTrigger).not.toBeNull();
    await act(async () => overflowTrigger?.click());
    const markAllReadButton = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
    ).find((item) => item.textContent?.includes('workspaceRuntime.notifications.markAllRead'));
    expect(markAllReadButton).toBeDefined();
    await act(async () => markAllReadButton?.click());
    expect(workspaceNotificationStore.getSnapshot()[0].readAt).not.toBeNull();
    expect(host.querySelector('[aria-label="Notifications 0"]')).not.toBeNull();

    const openAgent = document.querySelector<HTMLButtonElement>(
      '[aria-label="Open Agent needs input"]'
    );
    await act(async () => openAgent?.click());
    const openTargetButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.includes('workspaceRuntime.notifications.openTarget'));
    await act(async () => openTargetButton?.click());
    expect(openTarget).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    });
  });

  it('closes the panel when the window loses focus', async () => {
    workspaceNotificationStore.enqueue({
      title: 'Agent needs input',
      kind: 'info',
      source: 'agent',
      reason: 'action-required',
    });

    await act(async () => {
      root.render(
        createElement(WorkspaceNotificationCenter, {
          triggerClassName: 'trigger',
          triggerLabelClassName: 'label',
          onOpenTarget: vi.fn(),
        })
      );
    });

    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Notifications 1"]')?.click()
    );
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    });
  });

  it('copies diagnostic context for an error from its actions menu', async () => {
    workspaceNotificationStore.enqueue({
      title: 'Build failed',
      description: 'The packager exited with code 1.',
      details: 'Error: EACCES\nPath: /tmp/output',
      kind: 'error',
      source: 'system',
      reason: 'error',
      target: { projectId: 'project-1', taskId: 'task-1', conversationId: 'session-1' },
    });
    const notification = workspaceNotificationStore.getSnapshot()[0];

    await act(async () => {
      root.render(
        createElement(WorkspaceNotificationCenter, {
          triggerClassName: 'trigger',
          triggerLabelClassName: 'label',
          onOpenTarget: vi.fn(),
        })
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Notifications 1"]');
    await act(async () => trigger?.click());

    const moreActions = document.querySelector<HTMLButtonElement>(
      '[aria-label="More Build failed"]'
    );
    expect(moreActions).not.toBeNull();
    await userEvent.click(moreActions!);
    await vi.waitFor(() => {
      expect(findDropdownMenuItem('Copy debug info')).toBeDefined();
    });

    const copyDebugInfo = findDropdownMenuItem('Copy debug info');
    expect(copyDebugInfo).toBeDefined();
    await userEvent.click(copyDebugInfo!);
    await vi.waitFor(() => {
      expect(mocks.copyTextToClipboard).toHaveBeenCalledOnce();
    });

    const copied = mocks.copyTextToClipboard.mock.calls[0]?.[0] as string;
    expect(copied).toContain('Error: Build failed');
    expect(copied).toContain('Error: EACCES');
    expect(copied).toContain(`Notification ID: ${notification?.id}`);
    expect(copied).toContain('Source: system');
    expect(copied).toContain('Reason: error');
    expect(copied).toContain(
      'Target: {"projectId":"project-1","taskId":"task-1","conversationId":"session-1"}'
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Debug info copied');
  });

  it('hides excluded sources and records the choice', async () => {
    mocks.retainedSources = { toast: true, agent: false, automation: true, system: true };
    workspaceNotificationStore.enqueue({
      title: 'Agent needs input',
      kind: 'info',
      source: 'agent',
      reason: 'action-required',
    });
    workspaceNotificationStore.enqueue({
      title: 'Card moved to Review',
      kind: 'info',
      source: 'automation',
      reason: 'subscribed-result',
    });

    await act(async () => {
      root.render(
        createElement(WorkspaceNotificationCenter, {
          triggerClassName: 'trigger',
          triggerLabelClassName: 'label',
          onOpenTarget: vi.fn(),
        })
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Notifications 1"]');
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());
    expect(document.body.textContent).toContain('Card moved to Review');
    expect(document.body.textContent).not.toContain('Agent needs input');

    const overflowTrigger = document.querySelector<HTMLButtonElement>('[aria-label="common.more"]');
    expect(overflowTrigger).not.toBeNull();
    await userEvent.click(overflowTrigger!);
    const agentToggle = await vi.waitFor(() => {
      const item = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-checkbox-item"]')
      ).find((entry) =>
        entry.textContent?.includes('workspaceRuntime.notifications.sourceValue.agent')
      );
      expect(item).toBeDefined();
      return item!;
    });

    await userEvent.click(agentToggle);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      notificationCenterSources: { toast: true, agent: true, automation: true, system: true },
    });
  });
});

function findDropdownMenuItem(text: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')
  ).find((item) => item.textContent?.includes(text));
}
