import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexMaasAuthSwitch } from './codex-maas-auth-switch';

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

afterEach(async () => {
  await Promise.all([...temporaryHomes].map((path) => rm(path, { recursive: true, force: true })));
  temporaryHomes.clear();
});

describe('Codex MaaS native authentication switch', () => {
  let codexHome: string;
  let authPath: string;
  let configPath: string;
  let secrets: MemorySecretStore;
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
    await writeFile(authPath, originalAuth, { mode: 0o600 });
    await writeFile(configPath, originalConfig, { mode: 0o640 });
    secrets = new MemorySecretStore();
    authSwitch = new CodexMaasAuthSwitch(secrets);
  });

  it('switches Codex App to the MaaS key and restores the exact native files', async () => {
    await authSwitch.enable({
      codexHome,
      platformId: 'zenmux',
      endpoint: 'https://maas.example.test/v1/',
      apiKey: 'maas-secret',
    });

    expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'maas-secret',
    });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('# Auto-injected by Yoda MaaS\r\n');
    expect(activeConfig).toContain('model_provider = "zenmux"\r\n');
    expect(activeConfig).toContain('cli_auth_credentials_store = "file"\r\n');
    expect(activeConfig).toContain('[model_providers.zenmux]\r\n');
    expect(activeConfig).toContain('name = "ZenMux"\r\n');
    expect(activeConfig).toContain('base_url = "https://maas.example.test/v1"\r\n');
    expect(activeConfig).toContain('wire_api = "responses"\r\n');
    expect(activeConfig).toContain('requires_openai_auth = true\r\n');
    expect(activeConfig).not.toContain('env_key = "ZENMUX_API_KEY"\r\n');
    expect(activeConfig).not.toContain('maas-secret');
    expect(activeConfig).not.toContain('[shell_environment_policy.set]\r\n');
    expect(activeConfig).toContain('[features]\r\nfast_mode = true\r\n');
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(secrets.secrets.size).toBe(1);

    await authSwitch.disable({ codexHome });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
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

    expect(JSON.parse(await readFile(authPath, 'utf8'))).toMatchObject({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'second-secret',
    });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "openrouter"');
    expect(activeConfig).toContain('[model_providers.openrouter]');
    expect(activeConfig).toContain('requires_openai_auth = true');
    expect(activeConfig).not.toContain('env_key = "OPENROUTER_API_KEY"');
    expect(activeConfig).not.toContain('second-secret');
    expect(activeConfig).toContain('https://second.example.test/v1');

    await authSwitch.disable({ codexHome });
    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
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
    const rollback = await authSwitch.disable({ codexHome });

    await rollback();

    expect(await readFile(authPath, 'utf8')).toBe(activeAuth);
    expect(await readFile(configPath, 'utf8')).toBe(activeConfig);
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
    expect(activeConfig.match(/^ZENMUX_API_KEY\s*=/gm)).toHaveLength(1);
    expect(activeConfig).toContain('base_url = "https://zenmux.ai/api/v1"');
    expect(activeConfig).not.toContain('env_key = "ZENMUX_API_KEY"');
    expect(activeConfig).toContain('KEEP_ME = "yes"');
    expect(activeConfig).toContain('ZENMUX_API_KEY = "old-secret"');
    expect(activeConfig).not.toContain('new-secret');

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(configWithExistingProvider);
    expect((await stat(configPath)).mode & 0o777).toBe(0o640);
  });

  it('temporarily forces file-based API auth and restores the original credential store', async () => {
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
    expect(activeConfig).toContain('cli_auth_credentials_store = "file"');

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(keyringConfig);
  });
});
