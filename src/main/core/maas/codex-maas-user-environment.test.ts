import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ID, PRODUCT_NAME } from '@shared/app-identity';
import { CodexMaasUserEnvironment } from './codex-maas-user-environment';

const ENV_KEY = 'ZENMUX_API_KEY';
const temporaryHomes = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryHomes].map((path) => rm(path, { recursive: true, force: true })));
  temporaryHomes.clear();
});

describe('Codex MaaS user-session environment', () => {
  it('reads and publishes the variable through macOS launchd', async () => {
    const processEnvironment: NodeJS.ProcessEnv = {};
    const runExecFile = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'existing-secret\n', stderr: '' })
      .mockResolvedValue({ stdout: '', stderr: '' });
    const environment = new CodexMaasUserEnvironment('darwin', processEnvironment, runExecFile);

    await expect(environment.read(ENV_KEY)).resolves.toEqual({
      exists: true,
      value: 'existing-secret',
    });
    await environment.publish(ENV_KEY, 'maas-secret');

    expect(runExecFile).toHaveBeenNthCalledWith(1, '/bin/launchctl', ['getenv', ENV_KEY]);
    expect(runExecFile).toHaveBeenNthCalledWith(2, '/bin/launchctl', [
      'setenv',
      ENV_KEY,
      'maas-secret',
    ]);
    expect(processEnvironment[ENV_KEY]).toBe('maas-secret');
  });

  it('clears launchd and the current process when no previous value existed', async () => {
    const processEnvironment: NodeJS.ProcessEnv = {
      [ENV_KEY]: 'maas-secret',
    };
    const runExecFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const environment = new CodexMaasUserEnvironment('darwin', processEnvironment, runExecFile);

    await environment.restore(ENV_KEY, { exists: false });

    expect(runExecFile).toHaveBeenCalledWith('/bin/launchctl', ['unsetenv', ENV_KEY]);
    expect(processEnvironment[ENV_KEY]).toBeUndefined();
  });

  it('keeps non-macOS publishing process-scoped', async () => {
    const processEnvironment: NodeJS.ProcessEnv = {};
    const runExecFile = vi.fn();
    const environment = new CodexMaasUserEnvironment('linux', processEnvironment, runExecFile);

    await environment.publish(ENV_KEY, 'maas-secret');

    expect(runExecFile).not.toHaveBeenCalled();
    expect(processEnvironment[ENV_KEY]).toBe('maas-secret');
  });

  it('persists external Client sync in Keychain and a secret-free login item', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'yoda-maas-environment-'));
    temporaryHomes.add(homeDirectory);
    const processEnvironment: NodeJS.ProcessEnv = {};
    const runExecFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const runSecretCommand = vi.fn(async (_file: string, args: string[], _input?: string) => ({
      exitCode: 0,
      stdout: args[0] === 'find-generic-password' ? 'maas-secret\n' : '',
      stderr: '',
    }));
    const environment = new CodexMaasUserEnvironment('darwin', processEnvironment, runExecFile, {
      homeDirectory,
      userId: 501,
      runSecretCommand,
    });

    await environment.publishManaged(ENV_KEY, 'maas-secret');

    const scriptPath = join(
      homeDirectory,
      'Library',
      'Application Support',
      PRODUCT_NAME,
      'Yoda Model Access'
    );
    const plistPath = join(
      homeDirectory,
      'Library',
      'LaunchAgents',
      `${APP_ID}.codex-maas-environment.plist`
    );
    const [script, plist] = await Promise.all([
      readFile(scriptPath, 'utf8'),
      readFile(plistPath, 'utf8'),
    ]);
    expect(script).toContain("ENV_NAME='ZENMUX_API_KEY'");
    expect(script).not.toContain('maas-secret');
    expect(plist).not.toContain('maas-secret');
    expect(plist).toContain(`<string>${APP_ID}</string>`);
    expect(plist).toContain(`<string>${scriptPath}</string>`);
    expect(plist).not.toContain('<string>/bin/sh</string>');
    expect(runSecretCommand).toHaveBeenCalledWith(
      '/usr/bin/security',
      expect.arrayContaining(['add-generic-password', '-a', ENV_KEY, '-w']),
      'maas-secret\n'
    );
    const addArgs = runSecretCommand.mock.calls[0]?.[1] ?? [];
    expect(addArgs).not.toContain('maas-secret');
    expect(runExecFile).toHaveBeenCalledWith('/bin/launchctl', ['bootstrap', 'gui/501', plistPath]);
    await expect(environment.isManaged(ENV_KEY)).resolves.toBe(true);
    expect(processEnvironment[ENV_KEY]).toBe('maas-secret');

    await environment.clearManaged(ENV_KEY, { exists: false });

    await expect(readFile(scriptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(plistPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(processEnvironment[ENV_KEY]).toBeUndefined();
    expect(runSecretCommand).toHaveBeenCalledWith(
      '/usr/bin/security',
      expect.arrayContaining(['delete-generic-password', '-a', ENV_KEY]),
      undefined
    );
  });

  it('does not reinstall an unchanged login item during startup reconciliation', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'yoda-maas-environment-'));
    temporaryHomes.add(homeDirectory);
    const processEnvironment: NodeJS.ProcessEnv = {};
    const runExecFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const runSecretCommand = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const environment = new CodexMaasUserEnvironment('darwin', processEnvironment, runExecFile, {
      homeDirectory,
      userId: 501,
      runSecretCommand,
    });

    await environment.publishManaged(ENV_KEY, 'first-secret');
    await environment.publishManaged(ENV_KEY, 'updated-secret');

    const bootstrapCalls = runExecFile.mock.calls.filter(
      ([file, args]) => file === '/bin/launchctl' && args[0] === 'bootstrap'
    );
    const bootoutCalls = runExecFile.mock.calls.filter(
      ([file, args]) => file === '/bin/launchctl' && args[0] === 'bootout'
    );
    expect(bootstrapCalls).toHaveLength(1);
    expect(bootoutCalls).toHaveLength(1);
    expect(runExecFile).toHaveBeenCalledWith('/bin/launchctl', [
      'list',
      `${APP_ID}.codex-maas-environment`,
    ]);
    expect(processEnvironment[ENV_KEY]).toBe('updated-secret');
  });

  it('can publish for the current login session without installing a login item', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'yoda-maas-environment-'));
    temporaryHomes.add(homeDirectory);
    const processEnvironment: NodeJS.ProcessEnv = {};
    const runExecFile = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const runSecretCommand = vi.fn(async () => ({ exitCode: 44, stdout: '', stderr: '' }));
    const environment = new CodexMaasUserEnvironment('darwin', processEnvironment, runExecFile, {
      homeDirectory,
      userId: 501,
      runSecretCommand,
    });

    await environment.publishManaged(ENV_KEY, 'session-secret', false);

    expect(processEnvironment[ENV_KEY]).toBe('session-secret');
    expect(runExecFile).toHaveBeenCalledWith('/bin/launchctl', [
      'setenv',
      ENV_KEY,
      'session-secret',
    ]);
    expect(runSecretCommand).not.toHaveBeenCalledWith(
      '/usr/bin/security',
      expect.arrayContaining(['add-generic-password']),
      expect.anything()
    );
    await expect(environment.isManaged(ENV_KEY)).resolves.toBe(false);
  });

  it('never exposes the secret through launchctl error messages', async () => {
    const environment = new CodexMaasUserEnvironment(
      'darwin',
      {},
      vi.fn().mockRejectedValue(new Error('command included super-secret'))
    );

    const error = await environment
      .publish(ENV_KEY, 'super-secret')
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('super-secret');
  });

  it('never exposes the secret through Keychain error messages', async () => {
    const homeDirectory = await mkdtemp(join(tmpdir(), 'yoda-maas-environment-'));
    temporaryHomes.add(homeDirectory);
    const environment = new CodexMaasUserEnvironment(
      'darwin',
      {},
      vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      {
        homeDirectory,
        userId: 501,
        runSecretCommand: vi.fn().mockRejectedValue(new Error('included super-secret')),
      }
    );

    const error = await environment
      .publishManaged(ENV_KEY, 'super-secret')
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('super-secret');
  });
});
