import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@renderer/lib/i18n';
import { toast } from './use-toast';

const mocks = vi.hoisted(() => {
  const sonnerToast = Object.assign(
    vi.fn<(message: unknown, options?: unknown) => string>(() => 'toast-id'),
    {
      error: vi.fn<(message: unknown, options?: unknown) => string>(() => 'toast-id'),
      success: vi.fn<(message: unknown, options?: unknown) => string>(() => 'toast-id'),
    }
  );

  return {
    sonnerToast,
    writeText: vi.fn<(text: string) => Promise<void>>(),
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
    mocks.writeText.mockReset();
    mocks.writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } });
    await i18n.changeLanguage('en');
  });

  it('does not add a copy action to non-error toasts', () => {
    toast({
      title: 'Saved',
      description: 'Project settings updated.',
    });

    expect(mocks.sonnerToast).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.mock.calls[0][1] as ToastOptions;
    expect(options.action).toBeUndefined();
    expect(options.cancel).toBeUndefined();
  });

  it('keeps a custom action on a non-error toast without adding copy', () => {
    const undo = vi.fn();

    toast({
      title: 'Task archived',
      action: { label: 'Undo', onClick: undo },
    });

    expect(mocks.sonnerToast).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.mock.calls[0][1] as ToastOptions;
    expect(options.action?.label).toBe('Undo');
    expect(options.cancel).toBeUndefined();
  });

  it('adds a copy action to error toasts', async () => {
    toast.error('Something broke');

    expect(mocks.sonnerToast.error).toHaveBeenCalledTimes(1);
    const options = mocks.sonnerToast.error.mock.calls[0][1] as ToastOptions;
    expect(options.action?.label).toBe('Copy');

    await options.action?.onClick();

    expect(mocks.writeText).toHaveBeenCalledWith('Something broke');
    expect(mocks.sonnerToast.success).toHaveBeenCalledWith('Copied');
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
    expect(mocks.sonnerToast.success).toHaveBeenCalledWith('Debug info copied');
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
});
