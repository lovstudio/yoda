import { describe, expect, it, vi } from 'vitest';
import { resolveDevElectronExecutable } from '@root/scripts/lib/electron-runtime';

describe('dev Electron runtime', () => {
  it('loads the Electron package before preparing the dev bundle', async () => {
    const callOrder: string[] = [];
    const loadElectron = vi.fn(async () => {
      callOrder.push('load');
      return { default: '/tmp/Electron' };
    });
    const prepareElectronBundle = vi.fn(() => {
      callOrder.push('prepare');
      return '/tmp/Yoda';
    });
    const executableExists = vi.fn().mockReturnValue(true);

    await expect(
      resolveDevElectronExecutable({
        loadElectron,
        executableExists,
        prepareElectronBundle,
      })
    ).resolves.toBe('/tmp/Yoda');
    expect(callOrder).toEqual(['load', 'prepare']);
    expect(loadElectron).toHaveBeenCalledOnce();
    expect(executableExists).toHaveBeenCalledWith('/tmp/Electron');
    expect(executableExists).toHaveBeenCalledWith('/tmp/Yoda');
  });

  it('treats an empty configured executable as unset', async () => {
    const loadElectron = vi.fn().mockResolvedValue({ default: '/tmp/Electron' });

    await expect(
      resolveDevElectronExecutable({
        configuredExecutable: '',
        loadElectron,
        executableExists: () => true,
      })
    ).resolves.toBe('/tmp/Electron');
    expect(loadElectron).toHaveBeenCalledOnce();
  });

  it('uses a configured executable without loading the Electron package', async () => {
    const loadElectron = vi.fn();
    const prepareElectronBundle = vi.fn();

    await expect(
      resolveDevElectronExecutable({
        configuredExecutable: '/opt/custom-electron',
        loadElectron,
        executableExists: () => true,
        prepareElectronBundle,
      })
    ).resolves.toBe('/opt/custom-electron');
    expect(loadElectron).not.toHaveBeenCalled();
    expect(prepareElectronBundle).not.toHaveBeenCalled();
  });

  it('rejects an Electron package that does not expose an executable path', async () => {
    await expect(
      resolveDevElectronExecutable({
        loadElectron: async () => ({}),
        executableExists: () => true,
      })
    ).rejects.toThrow('Electron package did not resolve to an executable path.');
  });

  it('rejects a missing executable after the Electron package is loaded', async () => {
    await expect(
      resolveDevElectronExecutable({
        loadElectron: async () => ({ default: '/tmp/missing-electron' }),
        executableExists: () => false,
      })
    ).rejects.toThrow('Electron executable does not exist: /tmp/missing-electron');
  });
});
