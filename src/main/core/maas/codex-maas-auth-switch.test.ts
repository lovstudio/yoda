import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaasPlatformId } from '@shared/maas';
import { CodexMaasAuthSwitch } from './codex-maas-auth-switch';
import type {
  CodexMaasEnvironmentPublisher,
  EnvironmentVariableSnapshot,
} from './codex-maas-user-environment';

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(async () => null),
    setSecret: vi.fn(async () => undefined),
    deleteSecret: vi.fn(async () => undefined),
  },
}));

const temporaryHomes = new Set<string>();
const MAAS_ENDPOINT = 'https://maas.example.test/v1';

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

class MemoryUserEnvironment implements CodexMaasEnvironmentPublisher {
  readonly values = new Map<string, EnvironmentVariableSnapshot>();
  readonly managedValues = new Map<string, EnvironmentVariableSnapshot>();

  get(name: string): EnvironmentVariableSnapshot {
    return structuredClone(this.values.get(name) ?? { exists: false });
  }

  set(name: string, snapshot: EnvironmentVariableSnapshot): void {
    this.values.set(name, structuredClone(snapshot));
  }

  async read(name: string): Promise<EnvironmentVariableSnapshot> {
    return this.get(name);
  }

  async publish(name: string, value: string): Promise<void> {
    this.values.set(name, { exists: true, value });
  }

  async restore(name: string, snapshot: EnvironmentVariableSnapshot): Promise<void> {
    this.values.set(name, structuredClone(snapshot));
  }

  async readManaged(name: string): Promise<EnvironmentVariableSnapshot> {
    return structuredClone(this.managedValues.get(name) ?? { exists: false });
  }

  async isManaged(name: string): Promise<boolean> {
    return (this.managedValues.get(name) ?? { exists: false }).exists;
  }

  async publishManaged(name: string, value: string): Promise<void> {
    this.managedValues.set(name, { exists: true, value });
    this.values.set(name, { exists: true, value });
  }

  async clearManaged(name: string, snapshot: EnvironmentVariableSnapshot): Promise<void> {
    this.managedValues.set(name, { exists: false });
    this.values.set(name, structuredClone(snapshot));
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

  it('persists the MaaS bearer token in Codex config without replacing the OpenAI account', async () => {
    await enableMaas(authSwitch, codexHome, {
      platformId: 'zenmux',
      displayName: 'OpenAI',
    });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(userEnvironment.get('ZENMUX_API_KEY')).toEqual({ exists: false });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('# Auto-injected by Yoda MaaS\r\n');
    expect(activeConfig).toContain('model_provider = "yoda"\r\n');
    expect(activeConfig).toContain('model = "openai/gpt-5"\r\n');
    expect(activeConfig).toContain('[model_providers.yoda]\r\n');
    expect(activeConfig).toContain('name = "ZenMux"\r\n');
    expect(activeConfig).toContain(`base_url = "${MAAS_ENDPOINT}"\r\n`);
    expect(activeConfig).toContain('wire_api = "responses"\r\n');
    expect(activeConfig).not.toContain('env_key =');
    expect(activeConfig).toContain('experimental_bearer_token = "upstream-secret"\r\n');
    expect(activeConfig).not.toContain('[model_providers.yoda.auth]\r\n');
    expect(activeConfig).not.toContain('command = ');
    expect(activeConfig).not.toContain('requires_openai_auth');
    expect(activeConfig).toContain('[features]\r\nfast_mode = true\r\n');
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(secrets.secrets.size).toBe(1);
    await expect(authSwitch.getStatus({ codexHome })).resolves.toEqual({
      managed: true,
      configManaged: true,
      environmentPublished: false,
      persistentCredentialStored: true,
      envKey: null,
    });

    await authSwitch.disable({ codexHome });

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    const disabledConfig = await readFile(configPath, 'utf8');
    expect(disabledConfig).toContain('model = "gpt-5"\r\n');
    expect(disabledConfig).not.toContain('model_provider =');
    expect(disabledConfig).not.toContain('[model_providers.yoda]\r\n');
    expect(disabledConfig).not.toContain(MAAS_ENDPOINT);
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);
    expect((await stat(configPath)).mode & 0o777).toBe(0o640);
    expect(secrets.secrets.size).toBe(0);
    await expect(authSwitch.getStatus({ codexHome })).resolves.toEqual({
      managed: false,
      configManaged: false,
      environmentPublished: false,
      persistentCredentialStored: false,
      envKey: null,
    });
  });

  it('maps a generic ZenMux Profile model for external Codex and restores the native id', async () => {
    await writeFile(configPath, 'model = "gpt-5.6-sol"\n', { mode: 0o640 });

    await enableMaas(authSwitch, codexHome, {
      platformId: 'profile:new-zenmux',
      displayName: 'My ZenMux',
      endpoint: 'https://zenmux.ai/api/v1',
    });

    expect(await readFile(configPath, 'utf8')).toContain('model = "openai/gpt-5.6-sol"');

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toContain('model = "gpt-5.6-sol"');
  });

  it('keeps the external Codex app in the shared history bucket after returning to official auth', async () => {
    await enableMaas(authSwitch, codexHome);

    await authSwitch.enableOfficial({ codexHome });

    const officialConfig = await readFile(configPath, 'utf8');
    expect(officialConfig).toContain('model_provider = "yoda"');
    expect(officialConfig).toContain('[model_providers.yoda]');
    expect(officialConfig).toContain('name = "OpenAI"');
    expect(officialConfig).toContain('requires_openai_auth = true');
    expect(officialConfig).toContain('supports_websockets = true');
    expect(officialConfig).not.toContain(MAAS_ENDPOINT);
    expect(officialConfig).not.toContain('env_key =');
    expect(userEnvironment.get('ZENMUX_API_KEY')).toEqual({ exists: false });
    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);

    await authSwitch.disable({ codexHome });
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
  });

  it('updates the active platform without replacing the first snapshot', async () => {
    await enableMaas(authSwitch, codexHome, {
      platformId: 'zenmux',
      endpoint: 'https://first.example.test/v1',
    });
    await enableMaas(authSwitch, codexHome, {
      platformId: 'openrouter',
      displayName: 'OpenRouter',
      endpoint: 'https://second.example.test/v1',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "yoda"');
    expect(activeConfig).toContain('[model_providers.yoda]');
    expect(activeConfig).toContain('base_url = "https://second.example.test/v1"');
    expect(activeConfig).toContain('experimental_bearer_token = "upstream-secret"');
    expect(activeConfig.match(/\[model_providers\.yoda\]/g)).toHaveLength(1);
    expect(activeConfig).not.toContain('https://first.example.test/v1');
    expect(userEnvironment.get('OPENROUTER_API_KEY')).toEqual({ exists: false });
    expect(userEnvironment.get('ZENMUX_API_KEY')).toEqual({ exists: false });

    await authSwitch.disable({ codexHome });
    const disabledConfig = await readFile(configPath, 'utf8');
    expect(disabledConfig).not.toContain('model_provider =');
    expect(disabledConfig).not.toContain('[model_providers.yoda]');
  });

  it('routes LiteLLM through the shared Codex model provider', async () => {
    await enableMaas(authSwitch, codexHome, {
      platformId: 'litellm',
      displayName: 'LiteLLM',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "yoda"');
    expect(activeConfig).toContain('[model_providers.yoda]');
    expect(activeConfig).toContain('name = "LiteLLM"');
    expect(activeConfig).toContain('wire_api = "responses"');
  });

  it('routes New API through the shared Codex model provider', async () => {
    await enableMaas(authSwitch, codexHome, {
      platformId: 'newapi',
      displayName: 'New API',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "yoda"');
    expect(activeConfig).toContain('[model_providers.yoda]');
    expect(activeConfig).toContain('name = "New API"');
    expect(activeConfig).toContain('wire_api = "responses"');
  });

  it('routes CLIProxyAPI through the shared Codex model provider', async () => {
    await enableMaas(authSwitch, codexHome, {
      platformId: 'cliproxyapi',
      displayName: 'CLIProxyAPI',
    });

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "yoda"');
    expect(activeConfig).toContain('[model_providers.yoda]');
    expect(activeConfig).toContain('name = "CLIProxyAPI"');
    expect(activeConfig).toContain('wire_api = "responses"');
  });

  it('rolls an enable operation back without leaving a stale snapshot', async () => {
    const rollback = await enableMaas(authSwitch, codexHome);

    await rollback();

    expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    expect(userEnvironment.get('ZENMUX_API_KEY')).toEqual({ exists: false });
    expect(secrets.secrets.size).toBe(0);
  });

  it('rejects an empty MaaS endpoint without creating a snapshot', async () => {
    await expect(enableMaas(authSwitch, codexHome, { endpoint: '   ' })).rejects.toThrow(
      'non-empty MaaS endpoint'
    );

    expect(await readFile(configPath, 'utf8')).toBe(originalConfig);
    expect(secrets.secrets.size).toBe(0);
  });

  it('can roll a disable operation back when the surrounding settings update fails', async () => {
    await enableMaas(authSwitch, codexHome);
    const activeConfig = await readFile(configPath, 'utf8');
    const rollback = await authSwitch.disable({ codexHome });

    await rollback();

    expect(await readFile(configPath, 'utf8')).toBe(activeConfig);
    expect(secrets.secrets.size).toBe(1);
  });

  it('preserves an unrelated provider table and user shell policy', async () => {
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

    await enableMaas(authSwitch, codexHome);

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig.match(/\[model_providers\.yoda\]/g)).toHaveLength(1);
    expect(activeConfig.match(/\[model_providers\.yoda\.auth\]/g) ?? []).toHaveLength(0);
    expect(activeConfig.match(/^ZENMUX_API_KEY\s*=/gm)).toHaveLength(1);
    expect(activeConfig).toContain(`base_url = "${MAAS_ENDPOINT}"`);
    expect(activeConfig).toContain('experimental_bearer_token = "upstream-secret"');
    expect(activeConfig).toContain('/usr/bin/old-helper');
    expect(activeConfig).toContain('KEEP_ME = "yes"');
    expect(activeConfig).toContain('ZENMUX_API_KEY = "old-secret"');

    await authSwitch.disable({ codexHome });
    const disabledConfig = await readFile(configPath, 'utf8');
    expect(disabledConfig).toContain('model_provider = "zenmux"');
    expect(disabledConfig).toContain('name = "Old ZenMux"');
    expect(disabledConfig).toContain('base_url = "https://old.example.test/v1"');
    expect(disabledConfig).toContain('[model_providers.zenmux.auth]');
    expect(disabledConfig).toContain('command = "/usr/bin/old-helper"');
    expect(disabledConfig).toContain('KEEP_ME = "yes"');
  });

  it('replaces the legacy custom shared provider table', async () => {
    await writeFile(
      configPath,
      [
        'model_provider = "custom"',
        '',
        '[model_providers.custom]',
        'name = "Legacy shared provider"',
        'base_url = "https://legacy.example.test/v1"',
        'wire_api = "responses"',
        'env_key = "ZENMUX_API_KEY"',
        '',
      ].join('\n'),
      { mode: 0o640 }
    );

    await enableMaas(authSwitch, codexHome);

    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('model_provider = "yoda"');
    expect(activeConfig).toContain('[model_providers.yoda]');
    expect(activeConfig).not.toContain('[model_providers.custom]');
  });

  it('preserves the OpenAI credential-store preference and refreshed login', async () => {
    const keyringConfig = [
      'model = "gpt-5"',
      'cli_auth_credentials_store = "keyring"',
      '',
      '[features]',
      'fast_mode = true',
      '',
    ].join('\n');
    await writeFile(configPath, keyringConfig, { mode: 0o640 });

    await enableMaas(authSwitch, codexHome);
    const refreshedAuth = `${JSON.stringify({ auth_mode: 'chatgpt', refreshed: true })}\n`;
    await writeFile(authPath, refreshedAuth, { mode: 0o600 });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig.match(/^cli_auth_credentials_store\s*=/gm)).toHaveLength(1);
    expect(activeConfig).toContain('cli_auth_credentials_store = "keyring"');

    await authSwitch.disable({ codexHome });
    expect(await readFile(authPath, 'utf8')).toBe(refreshedAuth);
    const disabledConfig = await readFile(configPath, 'utf8');
    expect(disabledConfig).toContain('cli_auth_credentials_store = "keyring"');
    expect(disabledConfig).not.toContain('model_provider =');
    expect(disabledConfig).not.toContain('[model_providers.yoda]');
  });

  it('does not replace a user-owned session variable while global synchronization is enabled', async () => {
    userEnvironment.set('ZENMUX_API_KEY', { exists: true, value: 'user-owned-secret' });

    await enableMaas(authSwitch, codexHome);
    expect(userEnvironment.get('ZENMUX_API_KEY')).toEqual({
      exists: true,
      value: 'user-owned-secret',
    });

    await authSwitch.disable({ codexHome });
    expect(userEnvironment.get('ZENMUX_API_KEY')).toEqual({
      exists: true,
      value: 'user-owned-secret',
    });
  });

  it('migrates a v3 snapshot and clears the previously published upstream key', async () => {
    userEnvironment.set('YODA_MAAS_API_KEY', { exists: true, value: 'user-owned-secret' });
    await enableMaas(authSwitch, codexHome);
    const snapshotEntry = [...secrets.secrets.entries()][0];
    if (!snapshotEntry) throw new Error('Expected a stored native-files snapshot.');
    const [snapshotKey, serialized] = snapshotEntry;
    const legacySnapshot = JSON.parse(serialized) as Record<string, unknown>;
    legacySnapshot.version = 3;
    legacySnapshot.environment = { exists: true, value: 'user-owned-secret' };
    secrets.secrets.set(snapshotKey, JSON.stringify(legacySnapshot));
    userEnvironment.set('YODA_MAAS_API_KEY', {
      exists: true,
      value: 'legacy-upstream-secret',
    });
    await writeFile(tokenPath, 'legacy-command-auth-token\n', { mode: 0o600 });

    await enableMaas(authSwitch, codexHome, { endpoint: 'https://second.example.test/v1' });

    expect(userEnvironment.get('YODA_MAAS_API_KEY')).toEqual({
      exists: true,
      value: 'user-owned-secret',
    });
    await expect(readFile(tokenPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const activeConfig = await readFile(configPath, 'utf8');
    expect(activeConfig).toContain('base_url = "https://second.example.test/v1"');
    expect(activeConfig).toContain('experimental_bearer_token = "upstream-secret"');
    expect(activeConfig).not.toContain('legacy-upstream-secret');

    await authSwitch.disable({ codexHome });
    const disabledConfig = await readFile(configPath, 'utf8');
    expect(disabledConfig).not.toContain('model_provider =');
    expect(disabledConfig).not.toContain('[model_providers.yoda]');
    expect(disabledConfig).not.toContain('base_url = "https://second.example.test/v1"');
    expect(userEnvironment.get('YODA_MAAS_API_KEY')).toEqual({
      exists: true,
      value: 'user-owned-secret',
    });
  });
});

function enableMaas(
  authSwitch: CodexMaasAuthSwitch,
  codexHome: string,
  overrides: {
    platformId?: MaasPlatformId;
    displayName?: string;
    endpoint?: string;
    apiKey?: string;
  } = {}
) {
  return authSwitch.enable({
    codexHome,
    platformId: overrides.platformId ?? 'zenmux',
    displayName: overrides.displayName,
    endpoint: overrides.endpoint ?? MAAS_ENDPOINT,
    apiKey: overrides.apiKey ?? 'upstream-secret',
  });
}
