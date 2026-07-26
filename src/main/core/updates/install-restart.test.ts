import { describe, expect, it, vi } from 'vitest';
import { handoffInstallRestart } from './install-restart';

describe('handoffInstallRestart', () => {
  it('finishes application cleanup before handing control to the updater', async () => {
    const calls: string[] = [];
    const prepare = vi.fn(async () => {
      calls.push('prepare:start');
      await Promise.resolve();
      calls.push('prepare:done');
    });
    const quitAndInstall = vi.fn(() => {
      calls.push('quitAndInstall');
    });

    await handoffInstallRestart(prepare, quitAndInstall);

    expect(calls).toEqual(['prepare:start', 'prepare:done', 'quitAndInstall']);
  });

  it('keeps the application alive until an asynchronous updater handoff completes', async () => {
    let finishHandoff: (() => void) | undefined;
    let restartReady = false;
    const handoffToUpdater = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHandoff = resolve;
        })
    );

    const restart = handoffInstallRestart(async () => {}, handoffToUpdater).then(() => {
      restartReady = true;
    });

    await vi.waitFor(() => expect(handoffToUpdater).toHaveBeenCalledOnce());
    expect(restartReady).toBe(false);

    if (!finishHandoff) throw new Error('Updater handoff did not start');
    finishHandoff();
    await restart;

    expect(restartReady).toBe(true);
  });

  it('does not invoke the updater when cleanup fails', async () => {
    const error = new Error('cleanup failed');
    const quitAndInstall = vi.fn();

    await expect(
      handoffInstallRestart(async () => Promise.reject(error), quitAndInstall)
    ).rejects.toBe(error);
    expect(quitAndInstall).not.toHaveBeenCalled();
  });
});
