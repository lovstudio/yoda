import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@renderer/lib/i18n';
import { workspaceNotificationStore } from '@renderer/lib/stores/notification-store';
import { toast } from './use-toast';

const mocks = vi.hoisted(() => {
  let toastSequence = 0;
  const nextToastId = () => `toast-id-${++toastSequence}`;
  const sonnerToast = Object.assign(
    vi.fn<(message: unknown, options?: unknown) => string>(nextToastId),
    {
      error: vi.fn<(message: unknown, options?: unknown) => string>(nextToastId),
      success: vi.fn<(message: unknown, options?: unknown) => string>(nextToastId),
      loading: vi.fn<(message: unknown, options?: unknown) => string>(nextToastId),
      dismiss: vi.fn(),
    }
  );

  return {
    sonnerToast,
    writeText: vi.fn<(text: string) => Promise<void>>(),
    resetToastSequence: () => {
      toastSequence = 0;
    },
  };
});

vi.mock('sonner', () => ({
  toast: mocks.sonnerToast,
}));

type ToastActionOption = {
  label: string;
  onClick: () => void | Promise<void>;
};

type ToastOptions = {
  description?: string;
  action?: ToastActionOption;
  cancel?: ToastActionOption;
};

describe('toast', () => {
  beforeEach(async () => {
    mocks.sonnerToast.mockClear();
    mocks.sonnerToast.error.mockClear();
    mocks.sonnerToast.success.mockClear();
    mocks.sonnerToast.loading.mockClear();
    mocks.resetToastSequence();
    mocks.writeText.mockReset();
    mocks.writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
    await i18n.changeLanguage('en');
    workspaceNotificationStore.clear();
  });

  it('does not retain non-actionable toasts in the notification queue', () => {
    toast({
      title: 'Saved',
      description: 'Project settings updated.',
    });

    expect(mocks.sonnerToast).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.mock.calls[0][1] as ToastOptions;
    expect(options.action).toBeUndefined();
    expect(options.cancel).toBeUndefined();
    expect(workspaceNotificationStore.getSnapshot()).toEqual([]);
  });

  it('keeps a custom action on a non-error toast without adding copy', () => {
    const undo = vi.fn();

    toast(
      {
        title: 'Task archived',
        action: { label: 'Undo', onClick: undo },
      },
      { duration: 12_000 }
    );

    expect(mocks.sonnerToast).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.mock.calls[0][1] as ToastOptions;
    expect(options.action?.label).toBe('Undo');
    expect(options.cancel).toBeUndefined();
    expect(options).toMatchObject({ duration: 12_000 });

    const notification = workspaceNotificationStore.getSnapshot()[0];
    expect(workspaceNotificationStore.getAction(notification.id)?.label).toBe('Undo');
    workspaceNotificationStore.invokeAction(notification.id, undefined);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(workspaceNotificationStore.getAction(notification.id)).toBeUndefined();
    expect(workspaceNotificationStore.getSnapshot()).toEqual([]);
  });

  it('adds a copy action to error toasts', async () => {
    toast.error('Something broke');

    expect(mocks.sonnerToast.error).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.error.mock.calls[0][1] as ToastOptions;
    expect(options.action?.label).toBe('Copy');

    await options.action?.onClick();

    expect(mocks.writeText).toHaveBeenCalledWith('Something broke');
    expect(mocks.sonnerToast.success).toHaveBeenCalledWith('Copied', undefined);
    expect(workspaceNotificationStore.getSnapshot()).toMatchObject([
      { title: 'Something broke', kind: 'error', source: 'toast' },
    ]);
  });

  it('adds a one-click debug info copy action', async () => {
    toast({
      title: 'Clone failed',
      description: 'Could not create the worktree.',
      variant: 'destructive',
      debugInfo: { step: 'clone', error: new Error('branch not found') },
    });

    expect(mocks.sonnerToast.error).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.error.mock.calls[0][1] as ToastOptions;
    expect(options.description).toBe('Could not create the worktree.');
    expect(options.action?.label).toBe('Copy debug info');

    await options.action?.onClick();

    expect(mocks.writeText).toHaveBeenCalledTimes(1);
    const copiedText = mocks.writeText.mock.calls[0][0];
    expect(copiedText).toContain('Clone failed');
    expect(copiedText).toContain('Could not create the worktree.');
    expect(copiedText).toContain('"step": "clone"');
    expect(copiedText).toContain('"message": "branch not found"');
    expect(mocks.sonnerToast.success).toHaveBeenCalledWith('Debug info copied', undefined);
    expect(workspaceNotificationStore.getSnapshot()[0].details).toContain('branch not found');
  });

  it('keeps an existing toast action and adds debug copy as the secondary action', () => {
    const retry = vi.fn();

    toast({
      title: 'Push failed',
      variant: 'destructive',
      action: { label: 'Retry', onClick: retry },
      debugInfo: 'git push failed',
    });

    expect(mocks.sonnerToast.error).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.error.mock.calls[0][1] as ToastOptions;
    expect(options.action?.label).toBe('Retry');
    expect(options.cancel?.label).toBe('Copy debug info');

    void options.action?.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('copies debug log arrays as newline-delimited text', async () => {
    toast({
      title: 'SSH failed',
      variant: 'destructive',
      debugInfo: ['connecting', 'auth failed'],
    });

    const options = mocks.sonnerToast.error.mock.calls[0][1] as ToastOptions;
    await options.action?.onClick();

    expect(mocks.writeText).toHaveBeenCalledWith('SSH failed\n\nconnecting\nauth failed');
  });

  it('does not retain progress-only toast updates', () => {
    toast.loading('Checking…', { id: 'progress' });
    toast.success('Ready', { id: 'progress' });

    expect(workspaceNotificationStore.getSnapshot()).toEqual([]);
  });

  it('removes a retained toast when an update no longer requires action', () => {
    toast.success('Update available', {
      id: 'update',
      action: { label: 'Download', onClick: vi.fn() },
    });
    expect(workspaceNotificationStore.getSnapshot()).toHaveLength(1);

    toast.success('Up to date', { id: 'update' });

    expect(workspaceNotificationStore.getSnapshot()).toEqual([]);
  });
});
