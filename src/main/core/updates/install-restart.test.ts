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

  it('does not invoke the updater when cleanup fails', async () => {
    const error = new Error('cleanup failed');
    const quitAndInstall = vi.fn();

    await expect(
      handoffInstallRestart(async () => Promise.reject(error), quitAndInstall)
    ).rejects.toBe(error);
    expect(quitAndInstall).not.toHaveBeenCalled();
  });
});
