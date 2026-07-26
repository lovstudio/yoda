import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexMaasAuthSwitch } from './codex-maas-auth-switch';
import {
  CODEX_MAAS_API_KEY_ENV,
  type EnvironmentVariableSnapshot,
} from './codex-maas-user-environment';

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(async () => null),
    setSecret: vi.fn(async () => undefined),
    deleteSecret: vi.fn(async () => undefined),
  },
}));

const temporaryHomes = new Set<string>();

class MemorySecretStore {
  readonly secrets = new Map<string, string>();

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

class MemoryUserEnvironment {
  current: EnvironmentVariableSnapshot = { exists: false };

  async read(): Promise<EnvironmentVariableSnapshot> {
    return structuredClone(this.current);
  }

  async publish(value: string): Promise<void> {
    this.current = { exists: true, value };
  }

  async restore(snapshot: EnvironmentVariableSnapshot): Promise<void> {
    this.current = structuredClone(snapshot);
  }
}

afterEach(async () => {
  await Promise.all([...temporaryHomes].map((path) => rm(path, { recursive: true, force: true })));
  temporaryHomes.clear();
});

describe('Codex MaaS native authentication switch', () => {
  let codexHome: string;
  let authPath: string;
  let configPath: string;
  let tokenPath: string;
  let secrets: MemorySecretStore;
  let userEnvironment: MemoryUserEnvironment;
  let authSwitch: CodexMaasAuthSwitch;
  const originalAuth = `${JSON.stringify(
    {
      auth_mode: 'chatgpt',
      tokens: { access_token: 'access', refresh_token: 'refresh', id_token: 'id' },
      last_refresh: '2026-07-25T00:00:00.000Z',
    },
    null,
    2
  )}\n`;
  const originalConfig = 'model = "gpt-5"\r\n\r\n[features]\r\nfast_mode = true\r\n';

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), 'yoda-codex-maas-auth-'));
    temporaryHomes.add(codexHome);
    authPath = join(codexHome, 'auth.json');
    configPath = join(codexHome, 'config.toml');
    tokenPath = join(codexHome, '.yoda-maas-provider-token');
    await writeFile(authPath, originalAuth, { mode: 0o600 });
    await writeFile(configPath, originalConfig, { mode: 0o640 });
    secrets = new MemorySecretStore();
    userEnvironment = new MemoryUserEnvironment();
    authSwitch = new CodexMaasAuthSwitch(secrets, userEnvironment);
  });

  it('publishes env_key auth without replacing the Codex App OpenAI account', async () => {
    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      displayName: 'OpenAI',
      endpoint: 'https://maas.example.test/v1/',
      apiKey: 'maas-secret',
    });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: true, value: 'maas-secret' });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('# Auto-injected by Yoda MaaS\r\n');
    expect(activeConfig).toContain('model_provider = "zenmux"\r\n');
    expect(activeConfig).toContain('[model_providers.zenmux]\r\n');
    expect(activeConfig).toContain('name = "ZenMux"\r\n');
    expect(activeConfig).toContain('base_url = "https://maas.example.test/v1"\r\n');
    expect(activeConfig).toContain('wire_api = "responses"\r\n');
    expect(activeConfig).toContain(`env_key = "${CODEX_MAAS_API_KEY_ENV}"\r\n`);
    expect(activeConfig).not.toContain('[model_providers.zenmux.auth]\r\n');
    expect(activeConfig).not.toContain('command = ');
    expect(activeConfig).not.toContain('requires_openai_auth');
    expect(activeConfig).not.toContain('maas-secret');
    expect(activeConfig).not.toContain('[shell_environment_policy.set]\r\n');
    expect(activeConfig).toContain('[features]\r\nfast_mode = true\r\n');
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(secrets.secrets.size).toBe(1);

    await authSwitch.disable({ codexHome });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: false });
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);
    expect((await stat(configPath)).mode & 0o777).toBe(0o640);
    expect(secrets.secrets.size).toBe(0);
  });

  it('updates the active platform without replacing the first snapshot', async () => {
    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://first.example.test/v1',
      apiKey: 'first-secret',
    });
    await authSwitch.enable({
      codexHome,
      platformId: 'openrouter',
      displayName: 'OpenRouter',
      endpoint: 'https://second.example.test/v1',
      apiKey: 'second-secret',
    });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: true, value: 'second-secret' });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "openrouter"');
    expect(activeConfig).toContain('[model_providers.openrouter]');
    expect(activeConfig).not.toContain('[model_providers.openrouter.auth]');
    expect(activeConfig).not.toContain('requires_openai_auth');
    expect(activeConfig).toContain(`env_key = "${CODEX_MAAS_API_KEY_ENV}"`);
    expect(activeConfig).not.toContain('second-secret');
    expect(activeConfig).toContain('https://second.example.test/v1');

    await authSwitch.disable({ codexHome });
    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: false });
  });

  it('rolls an enable operation back without leaving a stale snapshot', async () => {
    const rollback = await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'maas-secret',
    });

    await rollback();

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: false });
    expect(secrets.secrets.size).toBe(0);
  });

  it('rejects an empty provider credential without creating a snapshot', async () => {
    await expect(
      authSwitch.enable({
        codexHome,
        platformId: 'zenmux',
        endpoint: 'https://maas.example.test/v1',
        apiKey: '   ',
      })
    ).rejects.toThrow('non-empty MaaS API key');

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    expect(secrets.secrets.size).toBe(0);
  });

  it('can roll a disable operation back when the surrounding settings update fails', async () => {
    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'maas-secret',
    });
    const activeAuth = await readFile(authPath, 'utf8');
    const activeConfig = await readFile(configPath, 'utf8');
    const activeEnvironment = structuredClone(userEnvironment.current);
    const rollback = await authSwitch.disable({ codexHome });

    await rollback();

    expect(await readFile(authPath, 'utf8')).toBe(activeAuth);
    expect(await readFile(configPath, 'utf8')).toBe(activeConfig);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual(activeEnvironment);
    expect(secrets.secrets.size).toBe(1);
  });

  it('replaces an existing provider table without rewriting the user shell policy', async () => {
    const configWithExistingProvider = [
      'model_provider = "zenmux"',
      '',
      '[model_providers.zenmux]',
      'name = "Old ZenMux"',
      'base_url = "https://old.example.test/v1"',
      'env_key = "ZENMUX_API_KEY"',
      '',
      '[model_providers.zenmux.auth]',
      'command = "/usr/bin/old-helper"',
      '',
      '[shell_environment_policy.set]',
      'KEEP_ME = "yes"',
      'ZENMUX_API_KEY = "old-secret"',
      '',
      '[features]',
      'fast_mode = true',
      '',
    ].join('\n');
    await writeFile(configPath, configWithExistingProvider, { mode: 0o640 });

    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1/',
      apiKey: 'new-secret',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig.match(/\[model_providers\.zenmux\]/g)).toHaveLength(1);
    expect(activeConfig.match(/\[model_providers\.zenmux\.auth\]/g) ?? []).toHaveLength(0);
    expect(activeConfig.match(/^ZENMUX_API_KEY\s*=/gm)).toHaveLength(1);
    expect(activeConfig).toContain('base_url = "https://zenmux.ai/api/v1"');
    expect(activeConfig).not.toContain('env_key = "ZENMUX_API_KEY"');
    expect(activeConfig).toContain(`env_key = "${CODEX_MAAS_API_KEY_ENV}"`);
    expect(activeConfig).not.toContain('/usr/bin/old-helper');
    expect(activeConfig).toContain('KEEP_ME = "yes"');
    expect(activeConfig).toContain('ZENMUX_API_KEY = "old-secret"');
    expect(activeConfig).not.toContain('new-secret');

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(configWithExistingProvider);
    expect((await stat(configPath)).mode & 0o777).toBe(0o640);
  });

  it('preserves the original OpenAI credential-store preference while MaaS is active', async () => {
    const keyringConfig = [
      'model = "gpt-5"',
      'cli_auth_credentials_store = "keyring"',
      '',
      '[features]',
      'fast_mode = true',
      '',
    ].join('\n');
    await writeFile(configPath, keyringConfig, { mode: 0o640 });

    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'maas-secret',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig.match(/^cli_auth_credentials_store\s*=/gm)).toHaveLength(1);
    expect(activeConfig).toContain('cli_auth_credentials_store = "keyring"');
    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(keyringConfig);
  });

  it('does not overwrite an OpenAI login refreshed while MaaS is active', async () => {
    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'maas-secret',
    });
    const refreshedAuth = `${JSON.stringify({ auth_mode: 'chatgpt', refreshed: true })}\n`;
    await writeFile(authPath, refreshedAuth, { mode: 0o600 });

    await authSwitch.disable({ codexHome });

    expect(await readFile(authPath, 'utf8')).toBe(refreshedAuth);
  });

  it('restores a pre-existing user-session variable after MaaS is disabled', async () => {
    userEnvironment.current = { exists: true, value: 'user-owned-secret' };

    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'maas-secret',
    });
    expect(userEnvironment.current).toEqual({ exists: true, value: 'maas-secret' });

    await authSwitch.disable({ codexHome });

    expect(userEnvironment.current).toEqual({ exists: true, value: 'user-owned-secret' });
  });

  it('upgrades a stored v2 snapshot and removes its legacy provider token', async () => {
    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'first-secret',
    });
    const snapshotEntry = [...secrets.secrets.entries()][0];
    if (!snapshotEntry) throw new Error('Expected a stored native-files snapshot.');
    const [snapshotKey, serialized] = snapshotEntry;
    const legacySnapshot = JSON.parse(serialized) as Record<string, unknown>;
    legacySnapshot.version = 2;
    delete legacySnapshot.environment;
    secrets.secrets.set(snapshotKey, JSON.stringify(legacySnapshot));
    userEnvironment.current = { exists: false };
    await writeFile(tokenPath, 'first-secret\n', { mode: 0o600 });

    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'second-secret',
    });
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: true, value: 'second-secret' });

    await authSwitch.disable({ codexHome });
    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.current).toEqual({ exists: false });
  });
});
