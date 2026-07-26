import { describe, expect, it, vi } from 'vitest';
import { CODEX_MAAS_API_KEY_ENV, CodexMaasUserEnvironment } from './codex-maas-user-environment';

describe('Codex MaaS user-session environment', () => {
  it('reads and publishes the variable through macOS launchd', async () => {
    const processEnvironment: NodeJS.ProcessEnv = {};
    const runExecFile = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'existing-secret\n', stderr: '' })
      .mockResolvedValue({ stdout: '', stderr: '' });
    const environment = new CodexMaasUserEnvironment('darwin', processEnvironment, runExecFile);

    await expect(environment.read()).resolves.toEqual({
      exists: true,
      value: 'existing-secret',
    });
    await environment.publish('maas-secret');

    expect(runExecFile).toHaveBeenNthCalledWith(1, '/bin/launchctl', [
      'getenv',
      CODEX_MAAS_API_KEY_ENV,
    ]);
    expect(runExecFile).toHaveBeenNthCalledWith(2, '/bin/launchctl', [
      'setenv',
      CODEX_MAAS_API_KEY_ENV,
      'maas-secret',
    ]);
    expect(processEnvironment[CODEX_MAAS_API_KEY_ENV]).toBe('maas-secret');
  });

  it('clears launchd and the current process when no previous value existed', async () => {
    const processEnvironment: NodeJS.ProcessEnv = {
      [CODEX_MAAS_API_KEY_ENV]: 'maas-secret',
    };
    const runExecFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const environment = new CodexMaasUserEnvironment('darwin', processEnvironment, runExecFile);

    await environment.restore({ exists: false });

    expect(runExecFile).toHaveBeenCalledWith('/bin/launchctl', [
      'unsetenv',
      CODEX_MAAS_API_KEY_ENV,
    ]);
    expect(processEnvironment[CODEX_MAAS_API_KEY_ENV]).toBeUndefined();
  });

  it('keeps non-macOS publishing process-scoped', async () => {
    const processEnvironment: NodeJS.ProcessEnv = {};
    const runExecFile = vi.fn();
    const environment = new CodexMaasUserEnvironment('linux', processEnvironment, runExecFile);

    await environment.publish('maas-secret');

    expect(runExecFile).not.toHaveBeenCalled();
    expect(processEnvironment[CODEX_MAAS_API_KEY_ENV]).toBe('maas-secret');
  });

  it('never exposes the secret through launchctl error messages', async () => {
    const environment = new CodexMaasUserEnvironment(
      'darwin',
      {},
      vi.fn().mockRejectedValue(new Error('command included super-secret'))
    );

    const error = await environment.publish('super-secret').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('super-secret');
  });
});
