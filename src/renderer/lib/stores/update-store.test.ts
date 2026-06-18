import { beforeEach, describe, expect, it, vi } from 'vitest';
import { menuCheckForUpdatesChannel } from '@shared/events/appEvents';
import { UpdateStore } from './update-store';

const mocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
  });

  return {
    eventHandlers: new Map<string, (data: unknown) => void>(),
    rpcAppVersion: vi.fn(async () => '0.3.2'),
    rpcUpdateCheck: vi.fn(),
    rpcUpdateGetState: vi.fn(),
    toast,
  };
});

vi.mock('sonner', () => ({
  toast: mocks.toast,
}));

vi.mock('@renderer/lib/i18n', () => {
  const translations: Record<string, string> = {
    'settings.update.availableToast': 'Update available',
    'settings.update.availableToastDescription': 'Version {{version}} is ready to download.',
    'settings.update.checkFailed': "Couldn't check for updates",
    'settings.update.checking': 'Checking for updates...',
    'settings.update.download': 'Download',
    'settings.update.downloadFailed': "Couldn't download the update",
    'settings.update.installFailed': "Couldn't install the update",
    'settings.update.manualDownload': 'Download manually',
    'settings.update.unavailableInBuild': 'Update checks are only available in packaged builds.',
    'settings.update.upToDate': "You're up to date.",
  };

  return {
    default: {
      t: (key: string, params?: Record<string, string>) => {
        const value = translations[key] ?? key;
        return value.replace('{{version}}', params?.version ?? '');
      },
    },
  };
});

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, handler: (data: unknown) => void) => {
      mocks.eventHandlers.set(event.name, handler);
      return () => {};
    }),
  },
  rpc: {
    app: {
      getAppVersion: mocks.rpcAppVersion,
    },
    update: {
      check: mocks.rpcUpdateCheck,
      download: vi.fn(),
      getState: mocks.rpcUpdateGetState,
      openLatest: vi.fn(),
      quitAndInstall: vi.fn(),
    },
  },
}));

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('UpdateStore', () => {
  beforeEach(() => {
    mocks.eventHandlers.clear();
    mocks.rpcAppVersion.mockReset();
    mocks.rpcAppVersion.mockResolvedValue('0.3.2');
    mocks.rpcUpdateCheck.mockReset();
    mocks.rpcUpdateGetState.mockReset();
    mocks.toast.mockClear();
    mocks.toast.dismiss.mockClear();
    mocks.toast.error.mockClear();
    mocks.toast.loading.mockClear();
    mocks.toast.loading.mockReturnValue('toast-id');
    mocks.toast.success.mockClear();
  });

  it('surfaces a menu-triggered check when updates are unavailable in this build', async () => {
    mocks.rpcUpdateCheck.mockResolvedValue({ success: true, result: null });
    const store = new UpdateStore();
    store.start();

    mocks.eventHandlers.get(menuCheckForUpdatesChannel.name)?.(undefined);
    await flushAsync();

    expect(mocks.toast.loading).toHaveBeenCalledWith('Checking for updates...', undefined);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Couldn't check for updates",
      expect.objectContaining({
        id: 'toast-id',
        description: 'Update checks are only available in packaged builds.',
        action: expect.objectContaining({ label: 'Download manually' }),
        cancel: expect.objectContaining({ label: 'common.copy' }),
      })
    );
    expect(store.state).toEqual({
      status: 'error',
      message: 'Update checks are only available in packaged builds.',
    });
  });

  it('reports up-to-date after a successful manual check with no available update', async () => {
    mocks.rpcUpdateCheck.mockResolvedValueOnce({
      success: true,
      result: { version: '0.3.2' },
    });
    mocks.rpcUpdateGetState.mockResolvedValueOnce({
      success: true,
      data: { status: 'idle', currentVersion: '0.3.2' },
    });
    const store = new UpdateStore();

    await store.check({ notify: true });

    expect(store.state).toEqual({ status: 'not-available' });
    expect(mocks.toast.success).toHaveBeenCalledWith("You're up to date.", { id: 'toast-id' });
  });

  it('reports the available version after a successful manual check', async () => {
    mocks.rpcUpdateCheck.mockResolvedValueOnce({
      success: true,
      result: { version: '0.3.3' },
    });
    mocks.rpcUpdateGetState.mockResolvedValueOnce({
      success: true,
      data: {
        status: 'available',
        currentVersion: '0.3.2',
        availableVersion: '0.3.3',
      },
    });
    const store = new UpdateStore();

    await store.check({ notify: true });

    expect(store.state).toEqual({ status: 'available', info: { version: '0.3.3' } });
    expect(mocks.toast.success).toHaveBeenCalledWith('Update available', {
      id: 'toast-id',
      description: 'Version 0.3.3 is ready to download.',
      action: expect.objectContaining({ label: 'Download' }),
    });
  });
});
