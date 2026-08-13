import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSettings } from '@shared/app-settings';
import {
  invalidateTerminalSettingsCache,
  loadTerminalSettings,
  patchTerminalSettingsCache,
  TERMINAL_SETTINGS_REQUEST_TIMEOUT_MS,
} from './terminal-settings-cache';

const mocks = vi.hoisted(() => ({
  getTerminalSettings: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      get: mocks.getTerminalSettings,
    },
  },
}));

function terminalSettings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return {
    autoCopyOnSelection: true,
    smartPathOpenMode: 'internal',
    scrollbackLines: 50_000,
    hotTerminalMode: 'auto',
    hotTerminalLimit: 4,
    idleSessionTimeoutMinutes: 5,
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('terminal settings cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTerminalSettingsCache();
  });

  it('does not let a pre-update RPC overwrite an optimistic patch when the cache was empty', async () => {
    const staleRequest = deferred<TerminalSettings>();
    const serverBeforeMutation = terminalSettings({ fontFamily: 'Old Mono' });
    mocks.getTerminalSettings
      .mockReturnValueOnce(staleRequest.promise)
      .mockResolvedValueOnce(serverBeforeMutation);

    const loadStartedBeforeUpdate = loadTerminalSettings();
    patchTerminalSettingsCache({ fontFamily: 'New Mono' });
    const currentLoad = loadTerminalSettings();

    await expect(currentLoad).resolves.toMatchObject({ fontFamily: 'New Mono' });
    staleRequest.resolve(serverBeforeMutation);
    await expect(loadStartedBeforeUpdate).resolves.toMatchObject({ fontFamily: 'New Mono' });
    await expect(loadTerminalSettings()).resolves.toMatchObject({ fontFamily: 'New Mono' });
    expect(mocks.getTerminalSettings).toHaveBeenCalledTimes(2);
  });

  it('reloads the authoritative server value after a successful mutation settles', async () => {
    mocks.getTerminalSettings.mockResolvedValueOnce(terminalSettings({ fontFamily: 'Old Mono' }));
    patchTerminalSettingsCache({ fontFamily: 'New Mono' });
    await expect(loadTerminalSettings()).resolves.toMatchObject({ fontFamily: 'New Mono' });

    invalidateTerminalSettingsCache();
    mocks.getTerminalSettings.mockResolvedValueOnce(
      terminalSettings({ fontFamily: 'New Mono', scrollbackLines: 60_000 })
    );

    await expect(loadTerminalSettings()).resolves.toMatchObject({
      fontFamily: 'New Mono',
      scrollbackLines: 60_000,
    });
  });

  it('drops the optimistic patch after a failed mutation so the server value wins', async () => {
    mocks.getTerminalSettings.mockResolvedValueOnce(terminalSettings({ fontFamily: 'Old Mono' }));
    patchTerminalSettingsCache({ fontFamily: 'New Mono' });
    await expect(loadTerminalSettings()).resolves.toMatchObject({ fontFamily: 'New Mono' });

    // useAppSettingsKey invalidates this cache from its failure path.
    invalidateTerminalSettingsCache();
    mocks.getTerminalSettings.mockResolvedValueOnce(terminalSettings({ fontFamily: 'Old Mono' }));

    await expect(loadTerminalSettings()).resolves.toMatchObject({ fontFamily: 'Old Mono' });
  });

  it('retries after a shared request times out and ignores its late response', async () => {
    vi.useFakeTimers();
    try {
      const stuckRequest = deferred<TerminalSettings>();
      const staleSettings = terminalSettings({ fontFamily: 'Stale Mono' });
      const currentSettings = terminalSettings({ fontFamily: 'Current Mono' });
      mocks.getTerminalSettings
        .mockReturnValueOnce(stuckRequest.promise)
        .mockResolvedValueOnce(currentSettings);

      const firstLoad = loadTerminalSettings();
      const firstResult = expect(firstLoad).rejects.toThrow(
        `Terminal settings request exceeded ${TERMINAL_SETTINGS_REQUEST_TIMEOUT_MS}ms`
      );
      await vi.advanceTimersByTimeAsync(TERMINAL_SETTINGS_REQUEST_TIMEOUT_MS);
      await firstResult;

      await expect(loadTerminalSettings()).resolves.toEqual(currentSettings);
      expect(mocks.getTerminalSettings).toHaveBeenCalledTimes(2);

      stuckRequest.resolve(staleSettings);
      await vi.runAllTimersAsync();
      await expect(loadTerminalSettings()).resolves.toEqual(currentSettings);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let an obsolete timeout release a newer shared request', async () => {
    vi.useFakeTimers();
    try {
      const obsoleteRequest = deferred<TerminalSettings>();
      const currentRequest = deferred<TerminalSettings>();
      const staleSettings = terminalSettings({ fontFamily: 'Stale Mono' });
      const currentSettings = terminalSettings({ fontFamily: 'Current Mono' });
      mocks.getTerminalSettings
        .mockReturnValueOnce(obsoleteRequest.promise)
        .mockReturnValueOnce(currentRequest.promise);

      const obsoleteLoad = loadTerminalSettings();
      await vi.advanceTimersByTimeAsync(1);
      invalidateTerminalSettingsCache();
      const currentLoad = loadTerminalSettings();

      // The obsolete request reaches its own deadline one millisecond before
      // the replacement. Its timer must not clear the replacement's slot.
      await vi.advanceTimersByTimeAsync(TERMINAL_SETTINGS_REQUEST_TIMEOUT_MS - 1);
      const joinedCurrentLoad = loadTerminalSettings();
      expect(mocks.getTerminalSettings).toHaveBeenCalledTimes(2);

      currentRequest.resolve(currentSettings);
      await expect(Promise.all([obsoleteLoad, currentLoad, joinedCurrentLoad])).resolves.toEqual([
        currentSettings,
        currentSettings,
        currentSettings,
      ]);

      obsoleteRequest.resolve(staleSettings);
      await vi.runAllTimersAsync();
      await expect(loadTerminalSettings()).resolves.toEqual(currentSettings);
    } finally {
      vi.useRealTimers();
    }
  });
});
